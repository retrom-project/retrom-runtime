import {ContentIOError} from "../../content-io/errors.js";
import type {NeoCDRange} from "./neocd-range.js";
import type {VirtualContentFile} from "./virtual-content-fs.js";

/** Native archives and discs share a session, never a file identity or cursor. */
export class FlycastFiles {
  private readonly files = new Map<string, NeoCDRange>();
  private readonly handles = new Map<number, NeoCDRange>();
  private nextHandle = 1;
  private suspended = 0;
  private readonly waiters = new Set<() => void>();
  private closing: Promise<void> | undefined;
  readonly contentFile: VirtualContentFile;
  constructor(entry: NeoCDRange, files: ReadonlyArray<{path: string; range: NeoCDRange}>, private readonly onError: (error: Error) => void) {
    for (const file of [{path: `/${entry.filename}`, range: entry}, ...files]) {
      const path = nativePath(file.path);
      if (!path || this.files.has(path)) {throw new ContentIOError("SOURCE_INVALID");}
      this.files.set(path, file.range);
    }
    this.contentFile = {filename: entry.filename, sizeBytes: entry.sizeBytes, canSuspend: true,
      read: (position, length) => entry.read(position, length), begin: () => this.begin(), end: () => this.end(),
      fail: error => this.fail(error), idle: () => this.idle(), quietFor: milliseconds => this.quietFor(milliseconds),
      dispose: () => this.dispose()};
  }
  open(path: string): number {
    if (this.closing) {return 0;}
    const key = nativePath(path), file = key && this.files.get(key);
    if (!file) {return 0;}
    const handle = this.nextHandle++;
    this.handles.set(handle, file);
    return handle;
  }
  size(handle: number) {return this.handles.get(handle)?.sizeBytes ?? 0;}
  close(handle: number) {this.handles.delete(handle);}
  read(handle: number, position: number, length: number) {
    if (this.closing) {throw new ContentIOError("ABORTED");}
    const file = this.handles.get(handle);
    if (!file) {throw new ContentIOError("SOURCE_INVALID");}
    return file.read(position, length);
  }
  begin() {if (this.closing) {throw new ContentIOError("ABORTED");} this.suspended++;}
  end() {
    if (!this.suspended) {throw new ContentIOError("INTERNAL");}
    if (--this.suspended === 0) {for (const resolve of this.waiters) {resolve();} this.waiters.clear();}
  }
  idle() {return this.suspended ? new Promise<void>(resolve => this.waiters.add(resolve)) : Promise.resolve();}
  quietFor(milliseconds: number) {
    return !this.closing && !this.suspended && [...this.files.values()].every(file => file.quietFor(milliseconds));
  }
  fail(error: Error) {if (!this.closing) {this.onError(error);}}
  dispose() {
    this.closing ??= Promise.resolve().then(async () => {
      await Promise.all([...this.files.values()].map(file => file.dispose()));
      await this.idle(); this.handles.clear(); this.files.clear();
    });
    return this.closing;
  }
}
function nativePath(path: string): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\\") ||
    Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {return null;}
  const parts = path.split("/").filter(part => part !== "" && part !== ".");
  return parts.length && !parts.includes("..") ? "/" + parts.join("/") : null;
}
