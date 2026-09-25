import {ContentIOError} from "../../content-io/errors.js";
import {contentLimits} from "../../content-io/limits.js";
import {neoCDRangeBlockSize} from "./neocd-range.js";

/** A materialized Content I/O file exposed through the shared EmulatorJS FS. */
export class EagerContentFile {
  readonly canSuspend = false;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly contents: Uint8Array;
  private closed = false;

  constructor(url: string, sha256: string, private readonly bytes: Uint8Array, private readonly onError: (error: Error) => void) {
    if (!/^[a-f0-9]{64}$/u.test(sha256) || bytes.byteLength < 1 || bytes.byteLength > contentLimits.signedDisc) {
      throw new ContentIOError("SOURCE_INVALID");
    }
    const path = new URL(url, "https://retrom.invalid").pathname;
    const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    if (name.length < 1 || name.length > 255 || name === "." || name === ".." ||
      [...name].some(char => char === "/" || char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      !/\.(adf|adz|dms|fdi|ipf|raw|hdf|hdz|lha|chd|nrg|iso)$/iu.test(name)) {
      throw new ContentIOError("SOURCE_INVALID");
    }
    this.filename = name;
    this.sizeBytes = bytes.byteLength;
    this.contents = bytes;
  }

  read(position: number, length: number): Uint8Array {
    if (this.closed) {throw new ContentIOError("ABORTED");}
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 1 ||
      length > neoCDRangeBlockSize || position > this.sizeBytes - length) {throw new ContentIOError("BOUNDS");}
    return this.bytes.subarray(position, position + length);
  }
  fail(error: Error) {if (!this.closed) {this.onError(error);}}
  begin() {}
  end() {}
  idle() {return Promise.resolve();}
  async dispose() {this.closed = true;}
}
