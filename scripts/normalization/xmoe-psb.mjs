import {requireXmoe, xmoeLimits, xmoeRange} from "./xmoe-common.mjs";

function stringTable(bytes, start, stop) {
  let at = start; const countBytes = xmoeRange(bytes, at++, 1)[0] - 12;
  requireXmoe(countBytes >= 1 && countBytes <= 4); const count = xmoeRange(bytes, at, countBytes).readUIntLE(0, countBytes); at += countBytes;
  const width = xmoeRange(bytes, at++, 1)[0] - 12; requireXmoe(width >= 1 && width <= 4 && count <= xmoeLimits.entries);
  requireXmoe(at + count * width <= stop); return {at, count, width};
}
function text(bytes, profile) {
  const start = Buffer.alloc(4), end = Buffer.alloc(4); start.writeUInt32LE(profile.startMarker); end.writeUInt32LE(profile.endMarker);
  const pieces = []; let at = 0;
  for (;;) {
    const first = bytes.indexOf(start, at);
    if (first < 0) {pieces.push(bytes.subarray(at)); break;}
    const last = bytes.indexOf(end, first + 4); requireXmoe(last >= 0);
    pieces.push(bytes.subarray(at, first)); const value = Buffer.from(bytes.subarray(first + 4, last));
    for (let i = 0; i < value.length; i++) {value[i] = (value[i] >>> profile.rotation) | (value[i] << (8 - profile.rotation) & 255);}
    pieces.push(value); at = last + 4;
  }
  const result = Buffer.concat(pieces);
  try {new TextDecoder("utf-8", {fatal: true}).decode(result);} catch {throw new Error("RUNTIME_XMOE_INVALID");}
  return result;
}
// Rebuild only the PSB v2 strings and their relative-offset vector. Name/node
// bytes and chunk contents remain verbatim; the three absolute chunk-section
// offsets shift together. No native hooks or game-specific script edits run.
export function normalizeXmoePsb(bytes, profile, signal) {
  signal?.throwIfAborted(); requireXmoe(bytes.length >= 40 && bytes.subarray(0, 8).equals(Buffer.from("5053420002000000", "hex")));
  const encryptData = bytes.readUInt32LE(8), names = bytes.readUInt32LE(12), table = bytes.readUInt32LE(16), data = bytes.readUInt32LE(20),
    chunks = bytes.readUInt32LE(24), lengths = bytes.readUInt32LE(28), chunkData = bytes.readUInt32LE(32), entries = bytes.readUInt32LE(36);
  requireXmoe(encryptData < table && names >= 40 && names <= entries && entries < table && table < data && data <= chunks &&
    chunks <= lengths && lengths <= chunkData && chunkData <= bytes.length);
  const vector = stringTable(bytes, table, data), offsets = Buffer.from(bytes.subarray(table, data)), strings = []; let size = 0;
  for (let i = 0; i < vector.count; i++) {
    signal?.throwIfAborted(); const off = xmoeRange(bytes, vector.at + i * vector.width, vector.width).readUIntLE(0, vector.width);
    requireXmoe(off < chunks - data); const end = bytes.indexOf(0, data + off); requireXmoe(end >= data + off && end < chunks);
    const value = text(bytes.subarray(data + off, end), profile); requireXmoe(size < 2 ** (vector.width * 8));
    offsets.writeUIntLE(size, vector.at - table + i * vector.width, vector.width); strings.push(value, Buffer.from([0])); size += value.length + 1;
    requireXmoe(size <= xmoeLimits.file, "RUNTIME_XMOE_LIMIT");
  }
  const delta = size - (chunks - data), output = Buffer.concat([bytes.subarray(0, table), offsets, ...strings, bytes.subarray(chunks)]);
  requireXmoe(output.length <= xmoeLimits.file, "RUNTIME_XMOE_LIMIT");
  for (const field of [24, 28, 32]) {output.writeUInt32LE(bytes.readUInt32LE(field) + delta, field);}
  return output;
}
