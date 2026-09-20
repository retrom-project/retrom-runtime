import {ReadAccounting} from "./read-accounting.js";
import type {ContentDiagnostic} from "./session-diagnostics.js";
import type {ContentSourceV1, ManagedInputPolicyV1, WorkerBootV1, MaterializeRequestV1, MaterializeResultV1} from "../../contracts/content-io/v1/content-io.js";
import {validateFetchPolicy, type ContentSessionOptions, type FetchPolicy} from "./fetch-policy.js";
import {SerialGate} from "./gate.js";
import {checkSignal,delay,requestScope} from "./abort.js";
import type {BlockObject} from "./block-pool.js";
import {PortRPC, wireError} from "./bridge/async.js";
import {type Address, type Message} from "./bridge/protocol.js";
import {closeSyncBuffer, createSyncBuffer} from "./bridge/blocking.js";
import {ClientJobs} from "./client-jobs.js";
import type {PreparationProgress} from "./progress.js";
import {ClientBlocks} from "./client-blocks.js";
import {ContentIOError, fail} from "./errors.js";
import {abi, contractSha256} from "./identity.js";
import {RangeReader} from "./range-reader.js";
import {contentObjectKey, type SourceContext, validateSource} from "./source.js";
import {validateManagedPolicy, validateSourcePolicy} from "./policy.js";
type ClientFile = {object: BlockObject; reader: RangeReader; policy: ManagedInputPolicyV1};
export class ContentSessionClient {
  readonly fetchPolicy: FetchPolicy;
  private readonly accounting = new ReadAccounting();
  private readonly diagnostic: (diagnostic: ContentDiagnostic) => void;
  readonly sessionId = crypto.randomUUID();
  readonly blocks: ClientBlocks;
  private readonly management: PortRPC;
  private readonly jobs: ClientJobs;
  private readonly files = new Map<string, ClientFile>();
  private readonly groups: string[][] = [];
  private readonly syncChannels = new Map<string, SharedArrayBuffer>();
  private syncBudgetAssigned = false;
  private readonly channels = new Map<number, PortRPC>();
  private readonly channelGate = new SerialGate();
  private readonly channelUsers = new Map<number, number>();
  private readonly sealed = new Set<number>();
  private readonly reportedObjects = new Set<string>();
  private backend: "OPFS" | "CACHE_BLOCKS" | "MEMORY" = "MEMORY";
  private closing: Promise<void> | undefined;
  private failure: ContentIOError | undefined;
  private readyResolve!: () => void;
  private readyReject!: (error: ContentIOError) => void;
  readonly ready = new Promise<void>((resolve, reject) => {this.readyResolve = resolve; this.readyReject = reject;});
  private readonly readyTimer: ReturnType<typeof setTimeout>;
  constructor(private readonly worker: Worker, private readonly context: SourceContext, private readonly onFailure: (error: ContentIOError) => void = () => {}, options: ContentSessionOptions = {}) {
    this.fetchPolicy = validateFetchPolicy(options.fetchPolicy); this.diagnostic = options.onDiagnostic ?? (() => {});
    const channel = new MessageChannel();
    const address: Address = {sessionId: this.sessionId, channelId: crypto.randomUUID(), epoch: 1};
    this.blocks = new ClientBlocks((object, signal) => this.channel(object, signal));
    this.management = new PortRPC(channel.port1, address, (message) => this.event(message), (error) => this.fail(error));
    this.jobs = new ClientJobs(this.management);
    this.readyTimer = setTimeout(() => this.fail(new ContentIOError("TIMEOUT")), 5000);
    worker.addEventListener("error", this.workerError); worker.addEventListener("messageerror", this.workerError);
    const boot: WorkerBootV1 = {type: "BOOT", v: 1, abi, contractSha256, sessionId: this.sessionId,
      managementChannelId: address.channelId, managementPort: channel.port2, storageOrigin: context.storageOrigin, allowedOrigins: context.allowedOrigins, l1BudgetBytes: 2097152, l2BudgetBytes: 14680064, fetchPolicy: this.fetchPolicy, diagnostics: true};
    try {worker.postMessage(boot, [channel.port2]);} catch {this.fail(new ContentIOError("INTERNAL"));}
  }
  get stats() {return {...this.blocks.stats, backend: this.backend, channels: this.channels.size, files: this.files.size, managementPending: this.management.stats.pending};}
  async open(input: ContentSourceV1, inputPolicy: ManagedInputPolicyV1, signal?: AbortSignal): Promise<RangeReader> {
    await this.ready; this.check(); checkSignal(signal);
    const source = validateSource(input, this.context), policy = validateManagedPolicy(inputPolicy); validateSourcePolicy(source, policy);
    const reply = await this.management.request({type: "OPEN", source, policy}, "OPEN_OK", {signal});
    this.check();
    const key = contentObjectKey(source, this.context.storageOrigin);
    if (reply.sizeBytes !== source.sizeBytes || reply.objectKey !== key) {this.fail(new ContentIOError("SOURCE_INVALID")); this.check();}
    const object: BlockObject = {key, source, state: {generation: this.sessionId, pinnedEtag: null, revoked: false}};
    const reader = new RangeReader(reply.fileId, object, this.blocks, () => this.releaseFile(reply.fileId), this.accounting.copied);
    this.files.set(reader.id, {reader, object, policy});
    // Groups are sealed when first opened; adding a file must never widen an existing capability.
    const index = this.groups.length - 1, group = this.groups[index];
    if (group && group.length < 128 && !this.sealed.has(index)) {group.push(reader.id);} else {this.groups.push([reader.id]);}
    return reader;
  }
  async createSyncChannel(fileId: string) {
    const scope = requestScope(undefined, 5000); let unlock: (() => void) | undefined;
    try {
      unlock = await this.channelGate.acquire(scope.signal);
      await this.availableChannel(scope.signal); return await this.openSyncChannel(fileId);
    } finally {unlock?.(); scope.dispose();}
  }
  private async openSyncChannel(fileId: string) {
    this.check(); const file = this.files.get(fileId);
    if (!file || file.policy.bridge !== "SYNC_WORKER") {fail("SOURCE_INVALID");}
    const channelId = crypto.randomUUID(), buffer = createSyncBuffer(1), pair = new MessageChannel();
    try {
      const reply = await this.management.request({type: "NEW_CHANNEL", consumerChannelId: channelId, allowedFileIds: [fileId],
        mode: "SYNC", port: pair.port2, buffer}, "CHANNEL_OK", {transfer: [pair.port2]});
      this.check(); if (reply.consumerChannelId !== channelId) {fail("SOURCE_INVALID");}
      const l1BudgetBytes = this.syncBudgetAssigned ? 0 : 2097152; this.syncBudgetAssigned = true; this.blocks.cache.resize(0);
      this.syncChannels.set(channelId, buffer);
      return {fileId, objectKey: file.object.key, sizeBytes: file.object.source.sizeBytes, port: pair.port1, buffer,
        sessionId: this.sessionId, channelId, epoch: reply.consumerEpoch, l1BudgetBytes};
    } catch (error) {pair.port1.close(); pair.port2.close(); closeSyncBuffer(buffer); throw error;}
  }
  async materialize(fileId: string, request: MaterializeRequestV1, signal?: AbortSignal, report?: (progress: PreparationProgress) => void): Promise<MaterializeResultV1> {
    this.check(); const file = this.files.get(fileId); if (!file) {fail("ABORTED");}
    return this.jobs.prepare(fileId, file.object, request, signal, report);
  }
  async closeFile(fileId: string): Promise<void> {await this.files.get(fileId)?.reader.close();}
  private async releaseFile(fileId: string): Promise<void> {
    const file = this.files.get(fileId); if (!file) {return;}
    this.files.delete(fileId);
    if (!this.failure) {await this.management.request({type: "CLOSE_FILE", fileId}, "FILE_CLOSED");}
  }
  close(): Promise<void> {
    if (this.closing) {return this.closing;}
    this.closing = (async () => {
      try {if (!this.failure) {await this.management.request({type: "CLOSE_SESSION"}, "SESSION_CLOSED");}}
      finally {this.fail(new ContentIOError("ABORTED"));}
    })();
    return this.closing;
  }
  fail(error: ContentIOError): void {
    if (this.failure) {return;} this.failure = error;
    for (const buffer of this.syncChannels.values()) {closeSyncBuffer(buffer, error.codeNumber);} this.syncChannels.clear();
    clearTimeout(this.readyTimer); this.readyReject(error); this.blocks.close(error); this.jobs.close(error);
    for (const file of this.files.values()) {void file.reader.close(error).catch(() => {});}
    this.files.clear(); for (const rpc of this.channels.values()) {rpc.close(error);} this.channels.clear();this.groups.length=0;this.sealed.clear();this.channelUsers.clear();this.reportedObjects.clear();
    this.management.close(error); this.worker.removeEventListener("error", this.workerError); this.worker.removeEventListener("messageerror", this.workerError); this.worker.terminate();
    if (!this.closing && error.code !== "CONTENT_IO_ABORTED") {this.onFailure(error);}
  }
  private readonly workerError = () => this.fail(new ContentIOError("INTERNAL"));
  private check() {if (this.failure) {throw this.failure;} if (this.closing) {fail("ABORTED");}}
  private event(message: Message): void {
    if (this.jobs?.event(message)) {return;}
    if (message.type === "READY") {
      if (message.abi !== abi || message.contractSha256 !== contractSha256) {this.fail(new ContentIOError("ABI_MISMATCH")); return;}
      clearTimeout(this.readyTimer); this.readyResolve(); return;
    }
    if (message.type === "BACKEND_READY") {this.backend = message.backend; return;}
    if (message.type === "FILE_REVOKED") {void this.files.get(message.fileId)?.reader.close(wireError(message.codeNumber)).catch(() => {}); return;}
    if (message.type === "OBJECT_REVOKED") {
      for (const file of this.files.values()) {if (file.object.key === message.objectKey) {file.object.state.revoked = true; void file.reader.close(wireError(message.codeNumber)).catch(() => {});}}
      this.blocks.cache.deletePrefix(`${message.objectKey}:`);
      // Management and each consumer port carry the same revocation. Close all
      // matching readers, but report the object failure to its owner only once.
      if (!this.reportedObjects.has(message.objectKey)) {
        this.reportedObjects.add(message.objectKey); this.onFailure(wireError(message.codeNumber));
      }
      return;
    }
    if (message.type === "CHANNEL_CLOSED") {
      for (const rpc of this.channels.values()) {if (rpc.address.channelId === message.channelId) {rpc.close(wireError(message.codeNumber));}}
      return;
    }
    if (message.type === "DIAGNOSTIC") {
      this.reportDiagnostic(message);
    }
  }
  private reportDiagnostic(message: Extract<Message, {type: "DIAGNOSTIC"}>): void {
      if (message.operation === "CLOSE" && this.closing) {this.blocks.cache.clear();}
      const hits = this.accounting.counts, counts = message.counts;
      this.diagnostic({sessionId: this.sessionId, operation: message.operation, codeNumber: message.codeNumber,
        counts: {...counts, memoryHitBytes: (counts.memoryHitBytes ?? 0) + hits.memoryHitBytes,
          persistentHitBytes: (counts.persistentHitBytes ?? 0) + hits.persistentHitBytes,
          cacheBytesL1: (counts.cacheBytesL1 ?? 0) + this.blocks.cache.byteLength,
          peakCacheBytesL1: Math.max(counts.peakCacheBytesL1 ?? 0, this.blocks.cache.peakByteLength)}});
      if (message.operation === "CLOSE" && message.codeNumber !== 0) {this.fail(wireError(message.codeNumber));}
  }
  private async channel(object: BlockObject, signal?: AbortSignal): Promise<{fileId: string; rpc: PortRPC; release: () => void}> {
    const unlock=await this.channelGate.acquire(signal);
    try {
      this.check();checkSignal(signal);
      const file=[...this.files.values()].find(file=>file.object===object);if(!file){fail("ABORTED");}
      const index=this.groups.findIndex(group=>group.includes(file.reader.id));this.sealed.add(index);
      let rpc=this.channels.get(index);
      if(!rpc){await this.availableChannel(signal);rpc=await this.openChannel(index);}
      this.channels.delete(index);this.channels.set(index,rpc);
      this.channelUsers.set(index,(this.channelUsers.get(index)??0)+1);let released=false;
      return {fileId:file.reader.id,rpc,release:()=>{if(!released){released=true;this.channelUsers.set(index,Math.max(0,(this.channelUsers.get(index)??1)-1));}}};
    } finally {unlock();}
  }
  private async availableChannel(signal?: AbortSignal):Promise<void> {
    for(;;){
      this.check();checkSignal(signal);
      for(const [id,buffer] of this.syncChannels){if(Atomics.load(new Int32Array(buffer),6)!==0){this.syncChannels.delete(id);}}
      if(this.channels.size+this.syncChannels.size<8){return;}
      const idle=[...this.channels].find(([index,rpc])=>!this.channelUsers.get(index)&&rpc.stats.pending===0);
      if(idle){
        this.channels.delete(idle[0]);await idle[1].request({type:"CLOSE_CHANNEL"},"CHANNEL_CLOSED");idle[1].close();return;
      }
      await delay(5,signal);
    }
  }
  private async openChannel(index: number): Promise<PortRPC> {
    this.check();
    const {port1, port2} = new MessageChannel(), channelId = crypto.randomUUID();
    try {
      const reply = await this.management.request({type: "NEW_CHANNEL", consumerChannelId: channelId,
        allowedFileIds: this.groups[index].filter((id) => this.files.has(id)), mode: "ASYNC", port: port2, buffer: null}, "CHANNEL_OK", {transfer: [port2]});
      this.check(); if (reply.consumerChannelId !== channelId) {fail("SOURCE_INVALID");}
      const rpc = new PortRPC(port1, {sessionId: this.sessionId, channelId, epoch: reply.consumerEpoch},
        (message) => this.event(message), () => {if (this.channels.get(index) === rpc) {this.channels.delete(index);}});
      this.channels.set(index, rpc); return rpc;
    } catch (error) {port1.close(); port2.close(); throw error;}
  }
}
export async function createContentSession(worker: Worker, context: SourceContext, options: ContentSessionOptions = {}): Promise<ContentSessionClient> {
  const session = new ContentSessionClient(worker, context, undefined, options); await session.ready; return session;
}
