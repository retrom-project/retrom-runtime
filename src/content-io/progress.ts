export type PreparationProgress = {readyBytes: number; totalBytes: number; networkBytes: number; attempt: 0 | 1; committed: boolean};
export class ContentProgress {
  private ready = 0;
  private last = -Infinity;
  private attempt: 0 | 1 = 0;
  constructor(readonly total: number, private readonly network: () => number, private readonly report: (progress: PreparationProgress) => void,
    private readonly now: () => number = () => performance.now()) {}
  start(): void {this.emit(false, true);}
  written(bytes: number): void {this.ready += bytes; this.emit(false);}
  position(bytes: number): void {this.ready = Math.max(this.ready,bytes); this.emit(false);}
  restart(): void {this.ready = 0; this.attempt = 1; this.emit(false, true);}
  complete(): void {this.ready = this.total; this.emit(true, true);}
  private emit(committed: boolean, force = false) {
    if (this.total === 0 || !committed && this.ready >= this.total) {return;}
    const now = this.now(); if (!force && now - this.last < 100) {return;} this.last = now;
    this.report({readyBytes: this.ready, totalBytes: this.total, networkBytes: this.network(), attempt: this.attempt, committed});
  }
}
