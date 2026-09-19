import type {ReadOrigin} from "../read-accounting.js";
import type {ContentMessageV1} from "../../../contracts/content-io/v1/content-io.js";
import {BufferCredits} from "../credits.js";
import {ContentIOError, errorNumbers, fail, toContentIOError} from "../errors.js";
import {RangeReader} from "../range-reader.js";
import {BLOCK_BYTES} from "../source.js";
import {base, parseConsumer, type Address} from "./protocol.js";
type Reading = {controller: AbortController; release?: () => void; timer?: ReturnType<typeof setTimeout>};
export class AsyncConsumerService {
  private sequence = 0;
  private readonly pending = new Map<number, Reading>();
  private readonly acknowledged = new Set<number>();
  private readonly readers: Map<string, RangeReader>;
  private closed = false;
  constructor(readonly port: MessagePort, readonly address: Address, readers: ReadonlyMap<string, RangeReader>,
    private readonly credits: BufferCredits, private readonly released: () => void) {
    this.readers = new Map(readers);
    port.onmessage = ({data}: MessageEvent<unknown>) => {
      try {this.receive(data);} catch (cause) {this.close(toContentIOError(cause));}
    };
    port.onmessageerror = () => this.close(new ContentIOError("INTERNAL")); port.start();
  }
  get stats() {return {pending: this.pending.size};}
  event(message: ContentMessageV1): void {if (!this.closed) {this.port.postMessage(message);}}
  revoke(fileId: string): void {
    if (!this.readers.delete(fileId)) {return;}
    this.event({...base(this.address, 0), type: "FILE_REVOKED", fileId, codeNumber: errorNumbers.ABORTED});
    if (this.readers.size === 0) {this.close();}
  }
  close(error = new ContentIOError("ABORTED"), requestId = 0): void {
    if (this.closed) {return;}
    this.event({...base(this.address, requestId), type: "CHANNEL_CLOSED", codeNumber: error.codeNumber}); this.closed = true;
    for (const task of this.pending.values()) {task.controller.abort(error); task.release?.(); clearTimeout(task.timer);}
    this.pending.clear(); this.acknowledged.clear(); this.readers.clear(); this.port.onmessage = null; this.port.onmessageerror = null; this.port.close(); this.released();
  }
  private receive(data: unknown): void {
    if (this.closed) {return;}
    const message = parseConsumer(data, this.address);
    switch (message.type) {
      case "READ": {
        if (message.requestId <= this.sequence) {fail("RANGE_INVALID");} this.sequence = message.requestId;
        if (this.pending.size >= 16) {fail("CAPACITY_EXCEEDED");}
        const reader = this.readers.get(message.fileId);
        if (!reader) {fail("SOURCE_INVALID");}
        if (message.offset % BLOCK_BYTES !== 0 || message.offset >= reader.sizeBytes || message.length !== Math.min(BLOCK_BYTES, reader.sizeBytes - message.offset)) {fail("BOUNDS");}
        const task: Reading = {controller: new AbortController()}; this.pending.set(message.requestId, task);
        void this.read(message, reader, task); break;
      }
      case "READ_ACK": this.ack(message.ackRequestId); break;
      case "CANCEL": {
        const task = this.pending.get(message.cancelRequestId); task?.controller.abort();
        if (task?.release) {this.ack(message.cancelRequestId);} break;
      }
      case "CLOSE_CHANNEL": this.close(new ContentIOError("ABORTED"), message.requestId); break;
      default: fail("SOURCE_INVALID");
    }
  }
  private ack(id: number): void {
    const task = this.pending.get(id);
    if (!task?.release) {if (this.acknowledged.has(id)) {return;} fail("RANGE_INVALID");}
    task.release(); clearTimeout(task.timer); this.pending.delete(id); this.acknowledged.add(id);
    if (this.acknowledged.size > 256) {this.acknowledged.delete(this.acknowledged.values().next().value!);}
  }
  private async read(message: Extract<ContentMessageV1, {type: "READ"}>, reader: RangeReader, task: Reading) {
    const deadline = setTimeout(() => task.controller.abort(new ContentIOError("TIMEOUT")), message.timeoutMs);
    let release: (() => void) | undefined;
    try {
      release = await this.credits.reserve(message.length, "OUTPUT", task.controller.signal);
      const bytes = new Uint8Array(message.length);
      let origin: ReadOrigin = "NETWORK";
      await reader.readInto(message.offset, bytes, task.controller.signal, (value) => {origin = value;});
      if (this.closed || task.controller.signal.aborted) {throw task.controller.signal.reason;}
      task.release = release; release = undefined;
      task.timer = setTimeout(() => this.close(new ContentIOError("TIMEOUT")), 5000);
      this.port.postMessage({...base(this.address, message.requestId), type: "READ_OK", fileId: reader.id,
        offset: message.offset, length: bytes.byteLength, bytes: bytes.buffer, origin}, [bytes.buffer]);
    } catch (cause) {
      const error = toContentIOError(cause); task.release?.(); clearTimeout(task.timer); this.pending.delete(message.requestId);
      this.event({...base(this.address, message.requestId), type: "READ_ERROR", codeNumber: error.codeNumber, scope: error.scope});
    } finally {clearTimeout(deadline); release?.();}
  }
}
