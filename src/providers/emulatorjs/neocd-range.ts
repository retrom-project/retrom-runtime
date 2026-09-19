import type {ContentReaderV1} from "../../../contracts/content-io/v1/content-io.js";
import {contentLimits} from "../../content-io/limits.js";
import {ContentIOError} from "../../content-io/errors.js";

export const neoCDRangeBlockSize = 256 * 1024;
type Disc = {sizeBytes: number; sha256: string};
/** Native Asyncify facade. All acquisition, caching and cancellation belong to the public Reader. */
export function createNeoCDRange(disc: Disc, reader: ContentReaderV1, fail: (error: Error) => void) {
  return new NeoCDRange(disc, reader, fail);
}
export class NeoCDRange {
  readonly filename: string;
  private readonly waiters = new Set<() => void>();
  private suspended = 0;
  private closing: Promise<void> | undefined;
  constructor(disc: Disc, private readonly reader: ContentReaderV1, private readonly onError: (error: Error) => void) {
    if (!/^[a-f0-9]{64}$/u.test(disc.sha256) || !Number.isSafeInteger(disc.sizeBytes) ||
      disc.sizeBytes < 1 || disc.sizeBytes > contentLimits.signedDisc || reader.sizeBytes !== disc.sizeBytes || reader.abi !== "content-io-v1") {
      throw new ContentIOError("SOURCE_INVALID");
    }
    this.filename = `${disc.sha256}.chd`;
  }
  fail(error: Error) {if (!this.closing) {this.onError(error);}}
  begin() {if (this.closing) {throw new ContentIOError("ABORTED");} ++this.suspended;}
  end() {
    if (this.suspended === 0) {throw new ContentIOError("INTERNAL");}
    if (--this.suspended === 0) {for (const resolve of this.waiters) {resolve();} this.waiters.clear();}
  }
  idle() {return this.suspended ? new Promise<void>(resolve => this.waiters.add(resolve)) : Promise.resolve();}
  dispose(): Promise<void> {
    // Closing the Reader settles pending reads; native finally/end remains its own barrier.
    this.closing ??= Promise.resolve().then(async () => {await this.reader.close(); await this.idle();});
    return this.closing;
  }
  read(position: number, length: number): Uint8Array | Promise<Uint8Array> {
    if (this.closing) {throw new ContentIOError("ABORTED");}
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 1 ||
      length > neoCDRangeBlockSize || position > this.reader.sizeBytes - length) {throw new ContentIOError("BOUNDS");}
    const output = new Uint8Array(length);
    if (this.reader.tryReadInto(position, output) !== null) {return output;}
    return this.reader.readInto(position, output).then(() => output);
  }
}
