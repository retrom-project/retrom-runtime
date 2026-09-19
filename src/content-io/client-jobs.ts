import {createRequiredSink,sinkOperation} from "./sink-operations.js";
import type {MaterializeRequestV1, MaterializeResultV1, MaterializeSinkV1} from "../../contracts/content-io/v1/content-io.js";
import {abortable, checkSignal, combineSignals, requestScope} from "./abort.js";
import type {BlockObject} from "./block-pool.js";
import {PortRPC} from "./bridge/async.js";
import {base, type Message} from "./bridge/protocol.js";
import {ContentIOError, fail, toContentIOError} from "./errors.js";
import type {PreparationProgress} from "./progress.js";
import {integer} from "./source.js";
type Job = {attempt: 0 | 1; createSink?: () => Promise<MaterializeSinkV1>; restarting?: boolean; id: string; object: BlockObject; controller: AbortController; sink?: MaterializeSinkV1;
  written: number; nextChunk: number; writing: Promise<void> | null; error?: ContentIOError; terminal: boolean; aborting?: Promise<void>;
  report: (progress: PreparationProgress) => void; networkBytes: number};
export class ClientJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly controller = new AbortController();
  constructor(private readonly rpc: PortRPC) {}
  async prepare(fileId: string, object: BlockObject, request: MaterializeRequestV1, signal?: AbortSignal,
    report: (progress: PreparationProgress) => void = () => {}): Promise<MaterializeResultV1> {
    checkSignal(signal); checkSignal(this.controller.signal);
    if (!integer(request.maxBytes) || object.source.sizeBytes > request.maxBytes) {fail("BOUNDS");}
    if (this.jobs.size >= 256) {fail("CAPACITY_EXCEEDED");}
    const job: Job = {attempt: 0, id: crypto.randomUUID(), object, controller: new AbortController(), written: 0, nextChunk: 0, writing: null, terminal: false, report, networkBytes: 0};
    const combined = combineSignals([this.controller.signal, job.controller.signal, ...(signal ? [signal] : [])]);
    this.jobs.set(job.id, job);
    try {
      if (request.kind === "SINK") {
        job.createSink=request.createSink; job.sink = await createRequiredSink(request.createSink,combined.signal);
      }
      checkSignal(combined.signal);
      const kind = request.kind === "SINK" ? "STREAM" : request.kind;
      const reply = await this.rpc.request({type: "PREPARE", fileId, jobId: job.id, result: kind, maxBytes: request.maxBytes}, "PREPARE_OK", {
        signal: combined.signal, timeoutMs: null, cancel: () => this.cancelRemote(job.id)});
      await job.writing; if (job.error) {throw job.error;} checkSignal(combined.signal);
      this.validate(reply, job, kind);
      if (job.sink) {
        if (job.written !== object.source.sizeBytes) {fail("LENGTH_MISMATCH");}
        await sinkOperation(()=>job.sink!.commit(reply.receipt),combined.signal,20000);
      }
      checkSignal(combined.signal); job.terminal = true;
      if (object.source.sizeBytes > 0) {report({readyBytes: object.source.sizeBytes, totalBytes: object.source.sizeBytes, networkBytes: job.networkBytes, attempt: job.attempt, committed: true});}
      return this.result(reply);
    } catch (cause) {
      job.terminal = true; this.cancelRemote(job.id);
      await job.writing;
      await this.abort(job, this.abortReason(signal));
      throw job.error ?? cause;
    } finally {this.jobs.delete(job.id); combined.dispose();}
  }
  event(message: Message): boolean {
    if (message.type !== "JOB_CHUNK" && message.type !== "JOB_PROGRESS" && message.type !== "JOB_RESTART") {return false;}
    const job = this.jobs.get(message.jobId);
    if (!job || job.terminal) {return true;}
    if(message.type === "JOB_RESTART"){this.restart(job);return true;}
    if(message.attempt < job.attempt){return true;}
    if (message.attempt !== job.attempt || job.restarting) {this.reject(job, new ContentIOError("RANGE_INVALID")); return true;}
    if (message.type === "JOB_PROGRESS") {this.progress(job,message);return true;}
    if (!job.sink || job.writing || message.chunkIndex !== job.nextChunk || message.offset !== job.written || message.bytes.byteLength > job.object.source.sizeBytes - job.written) {
      this.reject(job, new ContentIOError("RANGE_INVALID")); return true;
    }
    job.nextChunk++;
    job.writing = (async () => {
      try {
        const scope = requestScope(job.controller.signal, 5000);
        try {await abortable(job.sink!.write(message.offset, new Uint8Array(message.bytes)), scope.signal);} finally {scope.dispose();}
        checkSignal(job.controller.signal);
        if (job.terminal || this.controller.signal.aborted) {return;}
        job.written += message.bytes.byteLength;
        this.rpc.send({...base(this.rpc.address, 0), type: "JOB_ACK", jobId: job.id, attempt: job.attempt, chunkIndex: message.chunkIndex});
      } catch (cause) {this.reject(job, new ContentIOError("WORKSPACE_UNAVAILABLE", {cause}));}
      finally {job.writing = null;}
    })();
    return true;
  }
  private progress(job:Job,message:Extract<Message,{type:"JOB_PROGRESS"}>):void {
    if(message.totalBytes!==job.object.source.sizeBytes || message.readyBytes>message.totalBytes || message.networkBytes<job.networkBytes){this.reject(job,new ContentIOError("RANGE_INVALID"));return;}
    job.networkBytes=message.networkBytes;
    if(message.readyBytes<message.totalBytes){job.report({readyBytes:message.readyBytes,totalBytes:message.totalBytes,networkBytes:message.networkBytes,attempt:job.attempt,committed:false});}
  }
  private restart(job:Job):void {
    if(job.attempt!==0 || job.restarting){this.reject(job,new ContentIOError("RANGE_INVALID"));return;}
    job.restarting=true;
    const previous=job.writing;
    job.writing=(async()=>{
      try{
        await previous;if(job.error){throw job.error;}checkSignal(job.controller.signal);
        if(job.sink){await sinkOperation(()=>job.sink!.abort("RESTART"),job.controller.signal);}
        if(job.createSink){job.sink=await createRequiredSink(job.createSink,job.controller.signal);}
        checkSignal(job.controller.signal);job.attempt=1;job.written=0;job.nextChunk=0;job.restarting=false;
        this.rpc.send({...base(this.rpc.address,0),type:"JOB_RESTART_ACK",jobId:job.id,attempt:1});
      }catch(cause){this.reject(job,new ContentIOError("WORKSPACE_UNAVAILABLE",{cause}));}
      finally{job.writing=null;}
    })();
  }
  close(reason = new ContentIOError("ABORTED")): void {
    this.controller.abort(reason);
    for (const job of this.jobs.values()) {job.controller.abort(reason); void this.abort(job, "CANCELLED");}
  }
  private validate(reply: Extract<Message, {type: "PREPARE_OK"}>, job: Job, kind: "BYTES" | "BLOB" | "STREAM") {
    const {receipt} = reply, {source} = job.object;
    if (reply.attempt !== job.attempt || reply.jobId !== job.id || reply.kind !== kind || receipt.objectKey !== job.object.key || receipt.sizeBytes !== source.sizeBytes ||
      source.identity.kind === "FILE_SHA256" && (receipt.localSha256 !== source.identity.sha256 || receipt.assurance !== "EXPECTED_SHA256") ||
      source.identity.kind === "INDEX_ENTRY" && receipt.assurance !== "TRUSTED_IMMUTABLE_INDEX") {fail("CHECKSUM_MISMATCH");}
    this.validateResult(reply, kind, source.sizeBytes);
  }
  private validateResult(reply: Extract<Message, {type: "PREPARE_OK"}>, kind: "BYTES" | "BLOB" | "STREAM", size: number) {
    if (kind === "BYTES" ? reply.bytes?.byteLength !== size || reply.blob !== null || reply.leaseId !== null :
      kind === "BLOB" ? reply.blob?.size !== size || reply.bytes !== null || reply.leaseId === null :
        reply.bytes !== null || reply.blob !== null || reply.leaseId !== null) {fail("LENGTH_MISMATCH");}
  }
  private result(reply: Extract<Message, {type: "PREPARE_OK"}>): MaterializeResultV1 {
    if (reply.kind === "BYTES") {return {kind: "BYTES", bytes: new Uint8Array(reply.bytes!), receipt: reply.receipt};}
    if (reply.kind === "STREAM") {return {kind: "SINK", receipt: reply.receipt};}
    let released = false;
    return {kind: "BLOB", blob: reply.blob!, receipt: reply.receipt, release: async () => {
      if (!released) {released = true; if (!this.rpc.stats.closed) {await this.rpc.request({type: "RELEASE_LEASE", leaseId: reply.leaseId}, "RELEASE_OK");}}
    }};
  }
  private abortReason(signal?: AbortSignal): "CANCELLED" | "FAILED" {return signal?.aborted || this.controller.signal.aborted ? "CANCELLED" : "FAILED";}
  private abort(job: Job, reason: "CANCELLED" | "FAILED"): Promise<void> {
    if (!job.aborting) {
      job.aborting = (async () => {
        const scope = requestScope(undefined, 5000);
        try {await abortable(Promise.resolve().then(() => job.sink?.abort(reason)), scope.signal);} catch { /* Preserve the original failure. */ }
        finally {scope.dispose();}
      })();
    }
    return job.aborting;
  }
  private cancelRemote(jobId: string): void {
    if (!this.rpc.stats.closed) {void this.rpc.request({type: "JOB_CANCEL", jobId}, "CANCEL_OK").catch(() => {});}
  }
  private reject(job: Job, error: ContentIOError): void {job.error ??= toContentIOError(error); job.controller.abort(job.error);}
}
