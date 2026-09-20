import type {ContentMessageV1} from "../../../contracts/content-io/v1/content-io.js";
import {abortError, checkSignal} from "../abort.js";
import {ContentIOError, errorNumbers, fail, toContentIOError} from "../errors.js";
import {base, parseMessage, type Address, type Message} from "./protocol.js";
type Pending = {resolve: (message: Message) => void; reject: (error: ContentIOError) => void; clean: () => void; expected: string};
export function wireError(codeNumber: number): ContentIOError {
  const name = (Object.keys(errorNumbers) as (keyof typeof errorNumbers)[]).find((name) => errorNumbers[name] === codeNumber);
  return new ContentIOError(name ?? "INTERNAL");
}
/** Transport only: no source registration, storage or cache policy here. */
export class PortRPC {
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly awaitingAck = new Set<number>();
  private readonly cancelled = new Set<number>();
  private closed: ContentIOError | undefined;
  constructor(readonly port: MessagePort, readonly address: Address,
    private readonly event: (message: Message) => void, private readonly failed: (reason: ContentIOError) => void) {
    port.onmessage = ({data}: MessageEvent<unknown>) => {
      try {this.receive(parseMessage(data, address));} catch (error) {this.close(toContentIOError(error));}
    };
    port.onmessageerror = () => this.close(new ContentIOError("INTERNAL")); port.start();
  }
  get stats() {return {pending: this.pending.size + this.awaitingAck.size, closed: Boolean(this.closed)};}
  send(message: ContentMessageV1, transfer: Transferable[] = []): void {
    if (this.closed) {throw this.closed;}
    try {this.port.postMessage(message, transfer); if (message.type === "READ_ACK") {this.awaitingAck.delete(message.ackRequestId);}} catch (cause) {this.close(new ContentIOError("INTERNAL", {cause})); throw this.closed;}
  }
  request<Type extends Message["type"]>(payload: Record<string, unknown>, expected: Type,
    options: {signal?: AbortSignal; timeoutMs?: number | null; transfer?: Transferable[]; cancel?: (requestId: number) => void} = {}): Promise<Extract<Message, {type: Type}>> {
    checkSignal(options.signal);
    if (this.closed) {throw this.closed;}
    if (this.pending.size >= 256) {fail("CAPACITY_EXCEEDED");}
    const requestId = ++this.sequence;
    if (requestId > 2147483647) {this.close(new ContentIOError("CAPACITY_EXCEEDED")); throw this.closed;}
    return new Promise((resolve, reject) => {
      const finish = (error: ContentIOError) => {
        const pending = this.pending.get(requestId); if (!pending) {return;}
        this.pending.delete(requestId); pending.clean(); this.cancelled.add(requestId);
        if (this.cancelled.size > 256) {this.cancelled.delete(this.cancelled.values().next().value!);}
        try {options.cancel?.(requestId);} catch {this.close(new ContentIOError("INTERNAL"));} finally {reject(error);}
      };
      const abort = () => finish(abortError(options.signal!));
      const timer = options.timeoutMs === null ? undefined : setTimeout(() => finish(new ContentIOError("TIMEOUT")), options.timeoutMs ?? 5000);
      this.pending.set(requestId, {expected, resolve: (message) => resolve(message as Extract<Message, {type: Type}>), reject,
        clean: () => {clearTimeout(timer); options.signal?.removeEventListener("abort", abort);}});
      options.signal?.addEventListener("abort", abort, {once: true});
      try {this.port.postMessage({...base(this.address, requestId), ...payload}, options.transfer ?? []);}
      catch (cause) {finish(new ContentIOError("INTERNAL", {cause}));}
    });
  }
  close(reason = new ContentIOError("ABORTED")): void {
    if (this.closed) {return;} this.closed = reason;
    for (const pending of this.pending.values()) {pending.clean(); pending.reject(reason);}
    this.pending.clear(); this.cancelled.clear(); this.awaitingAck.clear(); this.port.onmessage = null; this.port.onmessageerror = null; this.port.close(); this.failed(reason);
  }
  private receive(message: Message) {
    if (this.closed) {return;}
    if (message.requestId === 0) {this.event(message); return;}
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      if (!this.cancelled.delete(message.requestId)) {fail("RANGE_INVALID");}
      if (message.type === "READ_OK") {this.send({...base(this.address, 0), type: "READ_ACK", ackRequestId: message.requestId});}
      return;
    }
    this.pending.delete(message.requestId); pending.clean();
    if (message.type === "ERROR" || message.type === "READ_ERROR") {pending.reject(wireError(message.codeNumber)); return;}
    if (message.type !== pending.expected) {const error = new ContentIOError("RANGE_INVALID"); pending.reject(error); throw error;}
    if (message.type === "READ_OK") {this.awaitingAck.add(message.requestId);}
    pending.resolve(message);
  }
}
