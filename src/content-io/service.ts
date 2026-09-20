import {SessionDiagnostics} from "./session-diagnostics.js";
import {delay} from "./abort.js";
import type {ContentMessageV1, ManagedInputPolicyV1, WorkerBootV1} from "../../contracts/content-io/v1/content-io.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {SyncConsumerService} from "./bridge/sync-service.js";
import {AsyncConsumerService} from "./bridge/async-service.js";
import {base, parseManagement, type Address} from "./bridge/protocol.js";
import {ContentIOError, fail, toContentIOError} from "./errors.js";
import {abi, contractSha256} from "./identity.js";
import {validateManagedPolicy, validateSourcePolicy} from "./policy.js";
import {RangeReader} from "./range-reader.js";
import {contentObjectKey, validateSource} from "./source.js";
import {ManagementJobs} from "./management-jobs.js";
import {WindowLoader} from "./window-loader.js";
import {ContentStoreManager} from "./store/manager.js";
type FileRecord = {reader: RangeReader; object: BlockObject; policy: ManagedInputPolicyV1};
export class ContentSessionService {
  readonly pool: BlockPool;
  private readonly windowLoader: WindowLoader;
  private readonly store: ContentStoreManager;
  private readonly jobs: ManagementJobs;
  private readonly files = new Map<string, FileRecord>();
  private readonly objects = new Map<string, BlockObject>();
  private readonly channels = new Map<string, AsyncConsumerService | SyncConsumerService>();
  private readonly diagnostics = new SessionDiagnostics();
  private readonly diagnosticTimer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private sequence = 0;
  private closed = false;
  readonly address: Address;
  constructor(private readonly boot: WorkerBootV1) {
    this.address = {sessionId: boot.sessionId, channelId: boot.managementChannelId, epoch: 1};
    this.pool = new BlockPool(boot.l1BudgetBytes, (object, index, signal) => this.store.read(object, index, signal),
      (object, error) => this.revoke(object, error), (object, signal) => this.store.prepare(object, signal), {policy: boot.fetchPolicy,
        local: (object, index, signal) => this.store.local(object, index, signal ?? new AbortController().signal),
        load: (object, window, signal, origins) => this.windowLoader.load(object, window, signal, origins)});
    this.store = new ContentStoreManager(boot.storageOrigin, this.pool.credits, (backend) => {
      if (backend === "OPFS" || backend === "CACHE_BLOCKS" || backend === "MEMORY") {this.send({...base(this.address, 0), type: "BACKEND_READY", backend});}
    }, (error, operation) => this.report(operation, error.codeNumber));
    this.windowLoader = new WindowLoader(this.store, this.pool.cache, (object, index) => this.pool.key(object, index));
    this.jobs = new ManagementJobs(this.pool, this.store, this.address, (message, transfer) => this.send(message, transfer), (object, error) => this.revoke(object, error));
    boot.managementPort.onmessage = ({data}: MessageEvent<unknown>) => {
      try {this.receive(data);} catch (cause) {this.close(toContentIOError(cause));}
    };
    boot.managementPort.onmessageerror = () => this.close(new ContentIOError("INTERNAL")); boot.managementPort.start();
    boot.managementPort.postMessage({...base(this.address, 0), type: "READY", abi, contractSha256, backend: "MEMORY"});
    if (boot.diagnostics) {this.diagnosticTimer = setInterval(() => this.report("READ"), 250);}
  }
  get stats() {return {...this.pool.stats, ...this.store.stats, materialization: this.jobs.stats, peaks: this.pool.peaks, files: this.files.size, channels: this.channels.size};}
  close(reason = new ContentIOError("ABORTED")): void {
    if (this.closed) {return;} this.closed = true; clearInterval(this.diagnosticTimer);
    for (const channel of this.channels.values()) {channel.close(reason);}
    for (const file of this.files.values()) {void file.reader.close(reason);}
    this.jobs.close(); this.files.clear(); this.objects.clear(); this.pool.close(reason); this.store.close();
    this.boot.managementPort.onmessage = null; this.boot.managementPort.onmessageerror = null; this.boot.managementPort.close();
  }
  private report(operation: Extract<ContentMessageV1, {type: "DIAGNOSTIC"}>["operation"], codeNumber = 0): void {
    if (this.boot.diagnostics || codeNumber !== 0) {this.send({...base(this.address, 0), type: "DIAGNOSTIC", operation, codeNumber, objectKey: null,
      counts: this.diagnostics.counts(this.pool, this.store, this.jobs, this.channels.size)});}
  }
  private async shutdown(requestId: number): Promise<void> {
    this.stopping = true; clearInterval(this.diagnosticTimer);
    for (const channel of this.channels.values()) {channel.close();}
    for (const file of this.files.values()) {void file.reader.close();}
    this.jobs.close(); this.pool.close(); this.store.close(); this.files.clear(); this.objects.clear();
    const deadline = performance.now() + 4000;
    while (this.pool.stats.active || this.pool.stats.temporaryBytes || this.jobs.stats.jobs || this.store.stats.optionalWrites) {
      if (performance.now() >= deadline) {
        this.report("CLOSE", 9); this.close(new ContentIOError("TIMEOUT")); return;
      }
      await delay(5);
    }
    this.report("CLOSE"); this.send({...base(this.address, requestId), type: "SESSION_CLOSED"}); this.close();
  }
  private revoke(object: BlockObject, error: ContentIOError): void {
    if (error.scope === "SESSION") {
      this.report("CLOSE", error.codeNumber); this.close(error); return;
    }
    this.send({...base(this.address, 0), type: "OBJECT_REVOKED", objectKey: object.key, codeNumber: error.codeNumber});
    for (const channel of this.channels.values()) {channel.event({...base(channel.address, 0), type: "OBJECT_REVOKED", objectKey: object.key, codeNumber: error.codeNumber});}
    for (const file of this.files.values()) {if (file.object.key === object.key) {void file.reader.close(error);}}
  }
  private send(message: ContentMessageV1, transfer: Transferable[] = []): void {if (!this.closed) {this.boot.managementPort.postMessage(message, transfer);}}
  private receive(data: unknown): void {
    if (this.closed || this.stopping) {return;}
    const message = parseManagement(data, this.address);
    if (message.type === "JOB_RESTART_ACK") {this.jobs.restartAck(message);return;}
    if (message.type === "JOB_ACK") {this.jobs.ack(message); return;}
    if (message.requestId <= this.sequence) {fail("RANGE_INVALID");} this.sequence = message.requestId;
    try {
      switch (message.type) {
        case "OPEN": this.open(message); break;
        case "NEW_CHANNEL": this.channel(message); break;
        case "PREPARE": {
          const file = this.files.get(message.fileId); if (!file) {fail("SOURCE_INVALID");} this.jobs.start(message, file); break;
        }
        case "JOB_CANCEL": this.jobs.cancel(message.jobId); this.send({...base(this.address, message.requestId), type: "CANCEL_OK", jobId: message.jobId}); break;
        case "RELEASE_LEASE": void this.jobs.release(message.leaseId).then(() => this.send({...base(this.address, message.requestId), type: "RELEASE_OK", leaseId: message.leaseId})); break;
        case "CLOSE_FILE": this.closeFile(message); break;
        case "CLOSE_SESSION": void this.shutdown(message.requestId); break;
        default: fail("SOURCE_INVALID");
      }
    } catch (cause) {
      const error = toContentIOError(cause);
      this.send({...base(this.address, message.requestId), type: "ERROR", codeNumber: error.codeNumber, scope: error.scope});
    }
  }
  private closeFile(message: Extract<ContentMessageV1, {type: "CLOSE_FILE"}>): void {
    this.jobs.cancelFile(message.fileId);
    const file = this.files.get(message.fileId); void file?.reader.close();
    for (const channel of this.channels.values()) {channel.revoke(message.fileId);}
    this.files.delete(message.fileId);
    if (file && ![...this.files.values()].some(other => other.object.key === file.object.key)) {this.store.release(file.object.key);}
    this.send({...base(this.address, message.requestId), type: "FILE_CLOSED", fileId: message.fileId});
  }
  private open(message: Extract<ContentMessageV1, {type: "OPEN"}>) {
    const source = validateSource(message.source, this.boot), policy = validateManagedPolicy(message.policy);
    validateSourcePolicy(source, policy);
    const key = contentObjectKey(source, this.boot.storageOrigin);
    let object = this.objects.get(key);
    if (!object) {
      object = {key, source, state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}}; this.objects.set(key, object);
    }
    object = {...object, source};
    this.pool.check(object);
    const id = crypto.randomUUID(), reader = new RangeReader(id, object, this.pool);
    this.files.set(id, {reader, object, policy});
    this.send({...base(this.address, message.requestId), type: "OPEN_OK", fileId: id, sizeBytes: source.sizeBytes, objectKey: key});
  }
  private channel(message: Extract<ContentMessageV1, {type: "NEW_CHANNEL"}>) {
    if (this.channels.size >= 8 || this.channels.has(message.consumerChannelId)) {fail("SOURCE_INVALID");}
    const readers = new Map<string, RangeReader>();
    for (const id of message.allowedFileIds) {
      const file = this.files.get(id);
      if (!file || file.policy.mode !== "RANGE") {fail("SOURCE_INVALID");} readers.set(id, file.reader);
    }
    if (readers.size === 0) {fail("SOURCE_INVALID");}
    const address = {sessionId: this.boot.sessionId, channelId: message.consumerChannelId, epoch: 1};
    const released = () => {this.diagnostics.release(message.consumerChannelId); this.channels.delete(message.consumerChannelId);};
    if (message.mode === "ASYNC") {
      if (message.buffer !== null) {fail("SOURCE_INVALID");}
      this.channels.set(message.consumerChannelId, new AsyncConsumerService(message.port, address, readers, this.pool.credits, released));
    } else {
      if (readers.size !== 1 || !message.buffer) {fail("SOURCE_INVALID");}
      const file = this.files.get(message.allowedFileIds[0])!;
      if (file.policy.bridge !== "SYNC_WORKER") {fail("SOURCE_INVALID");}
      this.channels.set(message.consumerChannelId, new SyncConsumerService(message.port, address, file.reader, message.buffer, file.object.key, this.pool.credits, released));
    }
    this.diagnostics.channel(message.consumerChannelId, message.buffer, this.channels.size);
    this.send({...base(this.address, message.requestId), type: "CHANNEL_OK", consumerChannelId: message.consumerChannelId, consumerEpoch: 1});
  }
}
