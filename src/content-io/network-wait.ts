import {checkSignal, delay} from "./abort.js";
import {ContentIOError, errorNumbers} from "./errors.js";

export type ContentNetworkState = "WAITING" | "RESTORED";
type Dependencies = {wait: (ms: number, signal?: AbortSignal) => Promise<void>; online: (listener: () => void) => () => void};
const defaults: Dependencies = {
  wait: delay,
  online: listener => {
    if (typeof globalThis.addEventListener !== "function") {return () => {};}
    globalThis.addEventListener("online", listener);
    return () => globalThis.removeEventListener("online", listener);
  },
};
/** Backoff between attempts while the network is unavailable; an `online` event retries at once. */
export const networkRetryDelaysMs = Object.freeze([1000, 2000, 4000, 8000]);

/** A request-scoped timeout or network failure; every other error still fails the read. */
export function transientNetworkError(error: unknown): boolean {
  return error instanceof ContentIOError && error.scope === "REQUEST" &&
    (error.codeNumber === errorNumbers.TIMEOUT || error.codeNumber === errorNumbers.NETWORK_FAILED);
}

/**
 * Session-wide network availability for on-demand reads. A read that fails transiently waits here and
 * retries instead of failing the runtime. WAITING is reported when the first read starts waiting and
 * RESTORED once every waiting read has succeeded again.
 */
export class NetworkWait {
  private readonly waiting = new Set<object>();
  private stalled = false;
  constructor(private readonly onChange: (state: ContentNetworkState) => void = () => {},
    private readonly dependencies: Dependencies = defaults) {}
  get state(): ContentNetworkState {return this.stalled ? "WAITING" : "RESTORED";}
  /** Marks `token` as waiting, then sleeps before its next attempt. */
  async wait(token: object, attempt: number, signal?: AbortSignal): Promise<void> {
    this.enter(token);
    const controller = new AbortController();
    const forward = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forward, {once: true});
    const stop = this.dependencies.online(() => controller.abort());
    try {
      checkSignal(signal);
      const ms = networkRetryDelaysMs[Math.min(attempt, networkRetryDelaysMs.length - 1)];
      await this.dependencies.wait(ms, controller.signal).catch(() => undefined);
      checkSignal(signal);
    } finally {stop(); signal?.removeEventListener("abort", forward);}
  }
  enter(token: object): void {
    this.waiting.add(token);
    if (!this.stalled) {this.stalled = true; this.onChange("WAITING");}
  }
  /** A read finished: successful reads clear the stall once nothing else is waiting. */
  leave(token: object, succeeded: boolean): void {
    if (!this.waiting.delete(token) && !succeeded) {return;}
    if (succeeded && this.stalled && this.waiting.size === 0) {this.stalled = false; this.onChange("RESTORED");}
  }
}
