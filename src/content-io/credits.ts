import {abortError, checkSignal} from "./abort.js";
import {ContentIOError, fail} from "./errors.js";
import {integer} from "./source.js";
import {TEMPORARY_BYTES, OUTPUT_BYTES, CACHE_WRITE_BYTES} from "./fetch-policy.js";
type Kind = "SCRATCH" | "OUTPUT" | "CACHE_WRITE";
type Claim = {bytes: number; kind: Kind; signal?: AbortSignal; abort: () => void; resolve: (release: () => void) => void; reject: (error: ContentIOError) => void};
export class BufferCredits {
  private used = 0;
  private output = 0;
  private cacheWrite = 0;
  private peak = {temporaryBytes: 0, outputBytes: 0, cacheWriteBytes: 0};
  private readonly waiting: Claim[] = [];
  constructor(readonly capacity = TEMPORARY_BYTES, readonly outputCapacity = OUTPUT_BYTES,
    readonly cacheWriteCapacity = capacity === TEMPORARY_BYTES ? CACHE_WRITE_BYTES : 0) {}
  get stats() {return {temporaryBytes: this.used, outputBytes: this.output, cacheWriteBytes: this.cacheWrite, waiting: this.waiting.length};}
  get peaks() {return {...this.peak};}
  reserve(bytes: number, kind: Kind, signal?: AbortSignal): Promise<() => void> {
    checkSignal(signal);
    const capacity = kind === "CACHE_WRITE" ? this.cacheWriteCapacity : this.capacity - this.cacheWriteCapacity;
    if (!integer(bytes, 0, capacity) || kind === "OUTPUT" && bytes > this.outputCapacity) {fail("CAPACITY_EXCEEDED");}
    if (this.waiting.length >= 256) {fail("CAPACITY_EXCEEDED");}
    return new Promise((resolve, reject) => {
      const claim: Claim = {bytes, kind, signal, resolve, reject, abort: () => {
        const index = this.waiting.indexOf(claim);
        if (index >= 0) {this.waiting.splice(index, 1); signal?.removeEventListener("abort", claim.abort); reject(abortError(signal!)); this.drain();}
      }};
      signal?.addEventListener("abort", claim.abort, {once: true});
      this.waiting.push(claim); this.drain();
    });
  }
  private drain(): void {
    for (let index = 0; index < this.waiting.length;) {
      const claim = this.waiting[index];
      const available = claim.kind === "CACHE_WRITE" ? this.cacheWriteCapacity - this.cacheWrite :
        this.capacity - this.cacheWriteCapacity - (this.used - this.cacheWrite);
      if (claim.bytes > available || claim.kind === "OUTPUT" && claim.bytes > this.outputCapacity - this.output) {index++; continue;}
      this.waiting.splice(index, 1); claim.signal?.removeEventListener("abort", claim.abort);
      this.used += claim.bytes;
      if (claim.kind === "CACHE_WRITE") {this.cacheWrite += claim.bytes;}
      if (claim.kind === "OUTPUT") {this.output += claim.bytes;}
      this.peak.temporaryBytes = Math.max(this.peak.temporaryBytes, this.used);
      this.peak.outputBytes = Math.max(this.peak.outputBytes, this.output);
      this.peak.cacheWriteBytes = Math.max(this.peak.cacheWriteBytes, this.cacheWrite);
      let released = false;
      claim.resolve(() => {
        if (released) {return;} released = true;
        if (claim.kind === "CACHE_WRITE") {this.cacheWrite -= claim.bytes;}
        this.used -= claim.bytes; if (claim.kind === "OUTPUT") {this.output -= claim.bytes;}
        this.drain();
      });
    }
  }
}
