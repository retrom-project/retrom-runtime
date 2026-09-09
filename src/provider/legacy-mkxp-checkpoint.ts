import {checkpointError, checkpointSize, transformCheckpoint} from "./checkpoint-compression.js";

const compactMagic = [0x52, 0x54, 0x4d, 0x4b, 0x58, 0x50, 0x53, 1];
export async function decodeLegacyMkxpCheckpoint(bytes: Uint8Array, maximum: number, signal?: AbortSignal) {
  checkpointSize(bytes, maximum);
  if ([0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0].every((value, index) => bytes[index] === value)) {return bytes;}
  if (bytes.byteLength <= 24 || !compactMagic.every((value, index) => bytes[index] === value)) {throw checkpointError();}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawSize = view.getUint32(8, true), prefixSize = view.getUint32(12, true);
  if (rawSize < 8 || rawSize > maximum || prefixSize < 8 || prefixSize > rawSize ||
    view.getUint32(16, true) !== bytes.length - 24 || view.getUint32(20, true) !== 1) {throw checkpointError();}
  const prefix = await transformCheckpoint(bytes.subarray(24), true, prefixSize, signal);
  if (prefix.length !== prefixSize || ![0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0].every((value, index) => prefix[index] === value)) {
    throw checkpointError();
  }
  const raw = new Uint8Array(rawSize); raw.set(prefix);
  return raw;
}
