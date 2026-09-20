import type {ReadOrigin} from "../read-accounting.js";
import type {ContentMessageV1} from "../../../contracts/content-io/v1/content-io.js";
import {BufferCredits} from "../credits.js";
import {ContentIOError, fail, toContentIOError} from "../errors.js";
import {RangeReader} from "../range-reader.js";
import {BLOCK_BYTES} from "../source.js";
import {controls, controlBytes, closeSyncBuffer, requested, State} from "./blocking.js";
import {wireError} from "./async.js";
import {base, parseConsumer, type Address} from "./protocol.js";
export class SyncConsumerService {
  private sequence = 0;
  private awaitingSlotFreeRequestId: number | null = null;
  private controller: AbortController | undefined;
  private release: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly control: Int32Array;
  constructor(readonly port: MessagePort, readonly address: Address, private readonly reader: RangeReader,
    private readonly buffer: SharedArrayBuffer, private readonly objectKey: string, private readonly credits: BufferCredits, private readonly released: () => void) {
    this.control = controls(buffer);
    port.onmessage = ({data}: MessageEvent<unknown>) => {try {this.receive(data);} catch (cause) {this.close(toContentIOError(cause));}};
    port.onmessageerror = () => this.close(new ContentIOError("INTERNAL")); port.start();
  }
  get stats() {return {pending: Number(Boolean(this.controller) || this.awaitingSlotFreeRequestId !== null)};}
  event(message: ContentMessageV1): void {if (message.type === "OBJECT_REVOKED" && message.objectKey === this.objectKey) {this.close(wireError(message.codeNumber));}}
  revoke(fileId: string): void {if (fileId === this.reader.id) {this.close();}}
  close(error = new ContentIOError("ABORTED"), requestId = 0): void {
    if (this.closed) {return;} this.closed = true;
    closeSyncBuffer(this.buffer, error.codeNumber); this.controller?.abort(error); this.release?.(); this.release = undefined;
    this.awaitingSlotFreeRequestId = null; clearTimeout(this.timer);
    this.port.postMessage({...base(this.address, requestId), type: "CHANNEL_CLOSED", codeNumber: error.codeNumber});
    this.port.onmessage = null; this.port.onmessageerror = null; this.port.close(); this.released();
  }
  private receive(data: unknown): void {
    if (this.closed) {return;}
    const message = parseConsumer(data, this.address);
    if (message.type === "SLOT_FREE") {
      // The shared slot may already contain the NEXT request. Only inspect service-owned accounting.
      if (message.completedRequestId !== this.awaitingSlotFreeRequestId) {fail("RANGE_INVALID");}
      this.release?.(); this.release = undefined; this.awaitingSlotFreeRequestId = null; clearTimeout(this.timer); return;
    }
    if (message.type === "CANCEL" || message.type === "CLOSE_CHANNEL") {this.close(new ContentIOError("ABORTED"), message.requestId); return;}
    if (message.type !== "READ" || message.fileId !== this.reader.id || message.requestId <= this.sequence || this.controller || this.awaitingSlotFreeRequestId !== null) {fail("RANGE_INVALID");}
    if (message.offset % BLOCK_BYTES !== 0 || message.offset >= this.reader.sizeBytes || message.length !== Math.min(BLOCK_BYTES, this.reader.sizeBytes - message.offset) ||
      !requested(this.control, this.address.epoch, message.requestId, message.length)) {fail("RANGE_INVALID");}
    this.sequence = message.requestId; this.controller = new AbortController(); void this.read(message, this.controller);
  }
  private async read(message: Extract<ContentMessageV1, {type: "READ"}>, controller: AbortController): Promise<void> {
    const deadline = setTimeout(() => controller.abort(new ContentIOError("TIMEOUT")), message.timeoutMs);
    let release: (() => void) | undefined;
    try {
      release = await this.credits.reserve(message.length, "OUTPUT", controller.signal);
      const bytes = new Uint8Array(message.length); let origin: ReadOrigin = "NETWORK";
      await this.reader.readInto(message.offset, bytes, controller.signal, value => {origin = value;});
      if (!requested(this.control, this.address.epoch, message.requestId, message.length)) {return;}
      new Uint8Array(this.buffer, controlBytes, message.length).set(bytes);
      Atomics.store(this.control, 4, message.length);
      Atomics.store(this.control, 8, {NETWORK: 0, MEMORY: 1, PERSISTENT: 2}[origin]);
      this.awaitingSlotFreeRequestId = message.requestId;
      if (Atomics.compareExchange(this.control, 0, State.REQUESTED, State.OK) !== State.REQUESTED) {this.awaitingSlotFreeRequestId = null; return;}
      this.release = release; release = undefined; this.timer = setTimeout(() => this.close(new ContentIOError("TIMEOUT")), 5000);
      Atomics.notify(this.control, 0);
    } catch (cause) {
      const error = toContentIOError(cause);
      this.close(error);
    } finally {release?.(); clearTimeout(deadline); this.controller = undefined;}
  }
}
