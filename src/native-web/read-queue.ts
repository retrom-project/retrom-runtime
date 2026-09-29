import {ContentIOError} from "../content-io/errors.js";

/** Admit reads before their Content I/O deadline starts; match the four reader slots. */
export class NativeReadQueue {
  private active = 0;
  private closed = false;
  private readonly waiting: Array<{enter: () => void; reject: (error: Error) => void}> = [];
  acquire(): Promise<() => void> {
    if (this.closed) {return Promise.reject(new ContentIOError("ABORTED"));}
    if (this.waiting.length >= 256) {return Promise.reject(new ContentIOError("CAPACITY_EXCEEDED"));}
    return new Promise((resolve, reject) => {
      const enter = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) {return;}
          released = true; this.active--;
          if (!this.closed) {this.waiting.shift()?.enter();}
        });
      };
      if (this.active < 4) {enter();} else {this.waiting.push({enter, reject});}
    });
  }
  close(): void {
    this.closed = true;
    for (const waiting of this.waiting.splice(0)) {waiting.reject(new ContentIOError("ABORTED"));}
  }
}
