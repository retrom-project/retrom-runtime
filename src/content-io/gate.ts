import {abortError, checkSignal} from "./abort.js";
import {fail} from "./errors.js";
type Waiting = {enter: () => void; cancel: () => void};
/** A bounded FIFO for whole materialization jobs; queued jobs have no file-wide read deadline. */
export class SerialGate {
  private active = false;
  private readonly waiting: Waiting[] = [];
  get stats() {return {active: Number(this.active), queued: this.waiting.length};}
  acquire(signal?: AbortSignal): Promise<() => void> {
    checkSignal(signal);
    if (this.waiting.length >= 256) {fail("CAPACITY_EXCEEDED");}
    return new Promise((resolve, reject) => {
      const waiting: Waiting = {enter: () => {
        signal?.removeEventListener("abort", waiting.cancel); this.active = true;
        let released = false;
        resolve(() => {if (!released) {released = true; this.active = false; this.waiting.shift()?.enter();}});
      }, cancel: () => {
        const index = this.waiting.indexOf(waiting);
        if (index >= 0) {this.waiting.splice(index, 1); signal?.removeEventListener("abort", waiting.cancel); reject(abortError(signal!));}
      }};
      if (!this.active) {waiting.enter();} else {this.waiting.push(waiting); signal?.addEventListener("abort", waiting.cancel, {once: true});}
    });
  }
}
