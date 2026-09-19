import type {MaterializationReceiptV1, MaterializeSinkV1} from "../../contracts/content-io/v1/content-io.js";
import {ContentIOError, fail} from "./errors.js";
export interface ResultSink extends MaterializeSinkV1 {result(): Uint8Array<ArrayBuffer> | Blob;}
class SinkPosition {
  protected written = 0;
  protected committed = false;
  protected aborted = false;
  constructor(protected readonly size: number) {}
  protected check(offset: number, chunk: Uint8Array): void {
    if (this.aborted || this.committed || offset !== this.written || chunk.length > this.size - offset) {fail("BOUNDS");}
    this.written += chunk.length;
  }
  async commit(receipt: MaterializationReceiptV1): Promise<void> {
    if (this.aborted || this.committed || this.written !== this.size || receipt.sizeBytes !== this.size) {fail("LENGTH_MISMATCH");}
    this.committed = true;
  }
}
export class BytesSink extends SinkPosition implements ResultSink {
  private bytes: Uint8Array<ArrayBuffer> | null;
  constructor(size: number) {
    super(size);
    try {this.bytes = new Uint8Array(size);} catch (cause) {throw new ContentIOError("RESOURCE_UNAVAILABLE", {cause});}
  }
  async write(offset: number, chunk: Uint8Array): Promise<void> {this.check(offset, chunk); this.bytes!.set(chunk, offset);}
  async abort(_reason?: "CANCELLED" | "FAILED" | "RESTART"): Promise<void> {if (!this.committed) {this.aborted = true; this.bytes = null;}}
  result(): Uint8Array<ArrayBuffer> {if (!this.committed || !this.bytes) {fail("RESOURCE_UNAVAILABLE");} const bytes = this.bytes; this.bytes = null; return bytes;}
}
export class BlobSink extends SinkPosition implements ResultSink {
  private chunks: Blob[] = [];
  private segments: Blob[] = [];
  async write(offset: number, chunk: Uint8Array): Promise<void> {
    this.check(offset, chunk);
    try {
      this.chunks.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
      if (this.chunks.length === 64) {this.segments.push(new Blob(this.chunks)); this.chunks = [];}
      if (this.segments.length === 64) {this.segments = [new Blob(this.segments)];}
    } catch (cause) {throw new ContentIOError("RESOURCE_UNAVAILABLE", {cause});}
  }
  async abort(_reason?: "CANCELLED" | "FAILED" | "RESTART"): Promise<void> {if (!this.committed) {this.aborted = true; this.chunks = []; this.segments = [];}}
  result(): Blob {
    if (!this.committed) {fail("RESOURCE_UNAVAILABLE");}
    try {const result = new Blob([...this.segments, ...this.chunks]); this.chunks = []; this.segments = []; return result;}
    catch (cause) {throw new ContentIOError("RESOURCE_UNAVAILABLE", {cause});}
  }
}
export {createWorkspaceSink, prepareWorkspaceProject, verifyWorkspaceFile} from "./sinks/workspace.js";
