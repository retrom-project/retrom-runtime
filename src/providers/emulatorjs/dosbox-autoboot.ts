import type {ContentReaderV1} from "../../../contracts/content-io/v1/content-io.js";
import {zipSync} from "fflate";
import {ContentIOError} from "../../content-io/errors.js";
import {canonicalPath} from "../../content-io/source.js";
import {contentLimits} from "../../content-io/limits.js";
import {NeoCDRange, neoCDRangeBlockSize} from "./neocd-range.js";

const maximumDirectoryBytes = 16 * 1024 * 1024;
type Directory = {count: number; offset: number; size: number};

/** Append native boot metadata; all original ZIP payloads and their offsets remain untouched. */
export class DOSAutobootRange extends NeoCDRange {
  override readonly sizeBytes: number;
  private closed = false;
  constructor(disc: {sha256: string; sizeBytes: number}, reader: ContentReaderV1, fail: (error: Error) => void,
    private readonly suffix: Uint8Array) {
    super(disc, reader, fail, "game.zip");
    this.sizeBytes = disc.sizeBytes + suffix.length;
    if (this.sizeBytes > contentLimits.signedDisc) {throw invalid();}
  }
  override read(position: number, length: number): Uint8Array | Promise<Uint8Array> {
    if (this.closed) {throw new ContentIOError("ABORTED");}
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 1 ||
      length > neoCDRangeBlockSize || position > this.sizeBytes - length) {throw new ContentIOError("BOUNDS");}
    const originalSize = this.sizeBytes - this.suffix.length;
    if (position >= originalSize) {return this.suffix.slice(position - originalSize, position - originalSize + length);}
    const originalLength = Math.min(length, originalSize - position), bytes = super.read(position, originalLength);
    if (originalLength === length) {return bytes;}
    const combine = (prefix: Uint8Array) => {
      const output = new Uint8Array(length); output.set(prefix);
      output.set(this.suffix.subarray(0, length - originalLength), originalLength); return output;
    };
    return bytes instanceof Promise ? bytes.then(combine) : combine(bytes);
  }
  override dispose() {this.closed = true; return super.dispose();}
}

export async function dosAutobootSuffix(range: NeoCDRange, entryPath: string): Promise<Uint8Array> {
  if (!canonicalPath(entryPath) || entryPath.length > 256 || /[:\r\n"]/u.test(entryPath)) {throw new Error("DOSBOX_ENTRY_INVALID");}
  const end = await readDirectoryInfo(range);
  const directory = await readBounded(range, end.offset, end.size);
  const records = directoryRecords(directory, end.count);
  const boot = zipSync({"AUTOBOOT.DBP": [new TextEncoder().encode("C:\\" + entryPath.replaceAll("/", "\\") + "\r\n"),
    {level: 0, mtime: new Date("1980-01-01T00:00:00Z")}]});
  const bootView = view(boot), bootEnd = boot.length - 22;
  const bootDirectoryOffset = bootView.getUint32(bootEnd + 16, true);
  const bootRecord = boot.slice(bootDirectoryOffset, bootEnd);
  view(bootRecord).setUint32(42, range.sizeBytes, true);
  const directorySize = records.reduce((sum, record) => sum + record.length, bootRecord.length);
  const output = new Uint8Array(bootDirectoryOffset + directorySize + 22);
  output.set(boot.subarray(0, bootDirectoryOffset));
  let at = bootDirectoryOffset;
  for (const record of [...records, bootRecord]) {output.set(record, at); at += record.length;}
  output.set(boot.subarray(bootEnd), at);
  const footer = view(output);
  footer.setUint16(at + 8, records.length + 1, true); footer.setUint16(at + 10, records.length + 1, true);
  footer.setUint32(at + 12, directorySize, true);
  footer.setUint32(at + 16, range.sizeBytes + bootDirectoryOffset, true);
  if (range.sizeBytes + output.length > contentLimits.signedDisc) {throw invalid();}
  return output;
}

async function readDirectoryInfo(range: NeoCDRange): Promise<Directory> {
  if (range.sizeBytes < 22) {throw invalid();}
  const length = Math.min(range.sizeBytes, 65557), tail = await range.read(range.sizeBytes - length, length), data = view(tail);
  for (let at = length - 22; at >= 0; at--) {
    if (data.getUint32(at, true) !== 0x06054b50 || at + 22 + data.getUint16(at + 20, true) !== length) {continue;}
    const count = data.getUint16(at + 10, true), size = data.getUint32(at + 12, true), offset = data.getUint32(at + 16, true);
    if (data.getUint16(at + 4, true) || data.getUint16(at + 6, true) || count === 65535 ||
      count !== data.getUint16(at + 8, true) || size > maximumDirectoryBytes || offset + size > range.sizeBytes - length + at) {throw invalid();}
    return {count, size, offset};
  }
  throw invalid();
}

async function readBounded(range: NeoCDRange, position: number, length: number) {
  const output = new Uint8Array(length);
  for (let at = 0; at < length; at += neoCDRangeBlockSize) {
    output.set(await range.read(position + at, Math.min(neoCDRangeBlockSize, length - at)), at);
  }
  return output;
}

function directoryRecords(bytes: Uint8Array, count: number): Uint8Array[] {
  const data = view(bytes), records = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || data.getUint32(at, true) !== 0x02014b50) {throw invalid();}
    const nameLength = data.getUint16(at + 28, true);
    const length = 46 + nameLength + data.getUint16(at + 30, true) + data.getUint16(at + 32, true);
    if (at + length > bytes.length || data.getUint16(at + 34, true) || data.getUint16(at + 8, true) & 1 ||
      [20, 24, 42].some(field => data.getUint32(at + field, true) === 0xffffffff)) {throw invalid();}
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name.toUpperCase() !== "AUTOBOOT.DBP") {records.push(bytes.subarray(at, at + length));}
    at += length;
  }
  if (at !== bytes.length || records.length >= 65534) {throw invalid();}
  return records;
}
function view(bytes: Uint8Array) {return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);}
function invalid() {return new Error("DOSBOX_ARCHIVE_INVALID");}
