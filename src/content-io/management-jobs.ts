import type {ContentMessageV1, ManagedInputPolicyV1, MaterializeRequestV1, MaterializeResultV1} from "../../contracts/content-io/v1/content-io.js";
import {abortable, checkSignal, requestScope} from "./abort.js";
import type {BlockObject, BlockPool} from "./block-pool.js";
import {base, type Address} from "./bridge/protocol.js";
import {ContentIOError, fail, toContentIOError} from "./errors.js";
import {ContentMaterializer} from "./materializer.js";
import type {ContentStoreManager} from "./store/manager.js";
type Job = {attempt: 0 | 1; restartAck?: () => void; controller: AbortController; fileId: string; requestId: number; nextChunk: number; ack?: {index: number; resolve: () => void}};
type File = {object: BlockObject; policy: ManagedInputPolicyV1};
export class ManagementJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly leases = new Map<string, () => Promise<void>>();
  private readonly materializer: ContentMaterializer;
  constructor(private readonly pool: BlockPool, store: ContentStoreManager, private readonly address: Address,
    private readonly send: (message: ContentMessageV1, transfer?: Transferable[]) => void,
    private readonly revoke: (object: BlockObject, reason: ContentIOError) => void) {this.materializer = new ContentMaterializer(pool, store);}
  get stats() {return {...this.materializer.stats, jobs: this.jobs.size, resultLeases: this.leases.size};}
  start(message: Extract<ContentMessageV1, {type: "PREPARE"}>, file: File): void {
    const expected = {BYTES: "BYTES", BLOB: "BLOB", WORKSPACE_FILE: "STREAM", READER: null}[file.policy.result];
    if (message.result !== expected || message.maxBytes > file.policy.maxFileBytes || file.object.source.sizeBytes > message.maxBytes) {fail("SOURCE_INVALID");}
    if (this.jobs.has(message.jobId) || this.jobs.size >= 256) {fail("CAPACITY_EXCEEDED");}
    const job: Job = {attempt: 0, controller: new AbortController(), fileId: message.fileId, requestId: message.requestId, nextChunk: 0};
    this.jobs.set(message.jobId, job);
    const request: MaterializeRequestV1 = message.result === "STREAM" ? {kind: "SINK", maxBytes: message.maxBytes, createSink: async () => ({
      write: (offset, chunk) => this.chunk(message.jobId, job, offset, chunk), commit: async () => {}, abort: async () => {}})} : {kind: message.result, maxBytes: message.maxBytes};
    void this.run(message, file, job, request);
  }
  ack(message: Extract<ContentMessageV1, {type: "JOB_ACK"}>): void {
    const job = this.jobs.get(message.jobId);
    if (!job || message.attempt !== job.attempt || job.ack?.index !== message.chunkIndex) {fail("RANGE_INVALID");}
    const ack = job.ack; job.ack = undefined; ack.resolve();
  }
  restartAck(message: Extract<ContentMessageV1,{type:"JOB_RESTART_ACK"}>): void {
    const job=this.jobs.get(message.jobId); if(!job?.restartAck || job.attempt!==1){fail("RANGE_INVALID");}
    const resolve=job.restartAck;job.restartAck=undefined;resolve();
  }
  private async restart(jobId:string,job:Job):Promise<void>{
    if(job.attempt!==0){fail("RANGE_INVALID");}job.attempt=1;job.nextChunk=0;
    const scope=requestScope(job.controller.signal,5000);
    try{const ack=new Promise<void>(resolve=>{job.restartAck=resolve;});
      this.send({...base(this.address,0),type:"JOB_RESTART",jobId,attempt:1});await abortable(ack,scope.signal);
    }finally{job.restartAck=undefined;scope.dispose();}
  }
  cancel(jobId: string): void {this.jobs.get(jobId)?.controller.abort();}
  cancelFile(fileId: string): void {for (const job of this.jobs.values()) {if (job.fileId === fileId) {job.controller.abort();}}}
  async release(leaseId: string): Promise<void> {const release = this.leases.get(leaseId); this.leases.delete(leaseId); await release?.();}
  close(): void {
    this.materializer.close(); for (const job of this.jobs.values()) {job.controller.abort();}
    for (const release of this.leases.values()) {void release();} this.leases.clear();
  }
  private async chunk(jobId: string, job: Job, offset: number, bytes: Uint8Array): Promise<void> {
    const scope = requestScope(job.controller.signal, 5000);
    let release: (() => void) | undefined;
    try {
      release = await this.pool.credits.reserve(bytes.length, "OUTPUT", scope.signal);
      checkSignal(scope.signal); const copy = Uint8Array.from(bytes), index = job.nextChunk++;
      const ack = new Promise<void>((resolve) => {job.ack = {index, resolve};});
      this.send({...base(this.address, 0), type: "JOB_CHUNK", jobId, attempt: job.attempt, chunkIndex: index, offset, bytes: copy.buffer}, [copy.buffer]);
      await abortable(ack, scope.signal);
    } finally {job.ack = undefined; release?.(); scope.dispose();}
  }
  private async run(message: Extract<ContentMessageV1, {type: "PREPARE"}>, file: File, job: Job, request: MaterializeRequestV1): Promise<void> {
    try {
      const result = await this.materializer.prepare(file.object, request, job.controller.signal, (progress) => {
        this.send({...base(this.address, 0), type: "JOB_PROGRESS", jobId: message.jobId, attempt: progress.attempt,
          readyBytes: progress.readyBytes, totalBytes: progress.totalBytes, networkBytes: progress.networkBytes});
      },()=>this.restart(message.jobId,job));
      checkSignal(job.controller.signal); this.deliver(message, result,job.attempt);
    } catch (cause) {
      const error = toContentIOError(cause);
      if (error.scope !== "REQUEST") {this.revoke(file.object, error);}
      this.send({...base(this.address, message.requestId), type: "ERROR", codeNumber: error.codeNumber, scope: error.scope});
    } finally {this.jobs.delete(message.jobId);}
  }
  private deliver(message: Extract<ContentMessageV1, {type: "PREPARE"}>, result: MaterializeResultV1,attempt: 0 | 1) {
    const leaseId = result.kind === "BLOB" ? crypto.randomUUID() : null;
    if (result.kind === "BLOB") {this.leases.set(leaseId!, result.release);}
    const bytes = result.kind === "BYTES" ? result.bytes.buffer as ArrayBuffer : null;
    this.send({...base(this.address, message.requestId), type: "PREPARE_OK", jobId: message.jobId, attempt,
      kind: result.kind === "SINK" ? "STREAM" : result.kind, bytes, blob: result.kind === "BLOB" ? result.blob : null, receipt: result.receipt, leaseId}, bytes ? [bytes] : []);
  }
}
