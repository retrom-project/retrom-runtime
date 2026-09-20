import {integer} from "./source.js";
import {fail} from "./errors.js";
type Entry = {bytes: Uint8Array<ArrayBuffer>; pins: number};
/** All arrays crossing this cache boundary are copied; leases never expose the backing. */
export class ByteLRU {
  private readonly entries = new Map<string, Entry>();
  private used = 0;
  private peakUsed = 0;
  constructor(private budget: number) {if (!integer(budget)) {fail("CAPACITY_EXCEEDED");}}
  get budgetBytes() {return this.budget;}
  resize(bytes: number): void {if (!integer(bytes)) {fail("CAPACITY_EXCEEDED");} this.clear(); this.budget = bytes;}
  get byteLength() {return this.used;}
  get peakByteLength() {return this.peakUsed;}
  get size() {return this.entries.size;}
  has(key: string, expectedLength?: number): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && (expectedLength === undefined || entry.bytes.length === expectedLength);
  }
  get(key: string): Uint8Array<ArrayBuffer> | null {
    const entry = this.touch(key);
    return entry?.bytes.slice() ?? null;
  }
  copyInto(key: string, offset: number, destination: Uint8Array): boolean {
    const entry = this.touch(key);
    if (!entry || offset < 0 || offset > entry.bytes.length - destination.length) {return false;}
    destination.set(entry.bytes.subarray(offset, offset + destination.length)); return true;
  }
  put(key: string, bytes: Uint8Array): boolean {
    if (bytes.length > this.budgetBytes || this.entries.get(key)?.pins) {return false;}
    this.delete(key);
    for (const [candidate, entry] of this.entries) {
      if (this.used + bytes.length <= this.budgetBytes) {break;}
      if (!entry.pins) {this.delete(candidate);}
    }
    if (this.used + bytes.length > this.budgetBytes) {return false;}
    this.entries.set(key, {bytes: Uint8Array.from(bytes), pins: 0}); this.used += bytes.length; this.peakUsed = Math.max(this.peakUsed, this.used); return true;
  }
  pin(key: string): (() => void) | null {
    const entry = this.touch(key);
    if (!entry) {return null;}
    entry.pins++;
    let released = false;
    return () => {if (!released) {released = true; entry.pins--;}};
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {this.used -= entry.bytes.length; this.entries.delete(key);}
  }
  deletePrefix(prefix: string): void {for (const key of this.entries.keys()) {if (key.startsWith(prefix)) {this.delete(key);}}}
  clear(): void {this.entries.clear(); this.used = 0;}
  private touch(key: string) {
    const entry = this.entries.get(key);
    if (entry) {this.entries.delete(key); this.entries.set(key, entry);}
    return entry;
  }
}
