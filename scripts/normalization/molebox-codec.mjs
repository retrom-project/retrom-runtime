import {inflateSync} from "node:zlib";

export const moleboxLimits = Object.freeze({image: 32 * 1024 * 1024, stage: 16 * 1024 * 1024,
  metadata: 16 * 1024 * 1024, file: 8 * 1024 ** 3, tree: 16 * 1024 ** 3, entries: 100000, packages: 64, block: 49152});
export function requireMolebox(value, code = "RUNTIME_MOLEBOX_INVALID") {if (!value) {throw new Error(code);}}
export function moleboxRange(bytes, offset, length) {
  requireMolebox(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 &&
    offset <= bytes.length && length <= bytes.length - offset);
  return bytes.subarray(offset, offset + length);
}
export async function readMoleboxAt(handle, size, offset, length, signal) {
  signal?.throwIfAborted();
  requireMolebox(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 &&
    offset <= size && length <= size - offset);
  const bytes = Buffer.alloc(length); let at = 0;
  while (at < length) {
    signal?.throwIfAborted();
    const result = await handle.read(bytes, at, length - at, offset + at);
    requireMolebox(result.bytesRead > 0); at += result.bytesRead;
  }
  return bytes;
}

// STEELBOX's 15-byte seed expands to eight 7-byte rounds and one 4-byte tail.
// The algorithm is a format property; seeds and substitution tables are read
// from the recognized loader/package, never chosen by a title or fingerprint.
export function moleboxKey(seed) {
  requireMolebox(seed.length >= 15);
  const out = []; let i = 11;
  for (let count = 0; count < 9; count++) {
    for (let j = 0; j < 4; j++) {out.push(seed[(i + j) % 15]);}
    i = (i + 12) % 15;
    if (i === 12) {requireMolebox(out.length === 60); return Uint8Array.from(out);}
    out.push(seed[i], seed[i + 1], seed[i + 2]); i = (i + 11) % 15;
  }
  throw new Error("RUNTIME_MOLEBOX_INVALID");
}
export function decodeMolebox(bytes, key, table, cbc = true) {
  requireMolebox(bytes.length % 8 === 0 && key.length === 60 && table.length === 256);
  const output = Buffer.from(bytes), previous = new Uint8Array(8), a = new Uint8Array(8);
  for (let at = 0; at < output.length; at += 8) {
    for (let j = 0; j < 8; j++) {a[j] = output[at + j];}
    for (let r = 0; r < 8; r++) {
      const p = r * 7;
      a[7] ^= table[a[3] ^ key[p + 3]]; a[4] ^= table[a[0] ^ key[p]];
      a[6] ^= table[a[2] ^ key[p + 2]]; a[5] ^= table[a[1] ^ key[p + 1]];
      a[1] ^= table[a[4] ^ key[p + 4]]; a[2] ^= table[a[4] ^ a[5]];
      a[3] ^= table[a[6] ^ key[p + 5]]; a[0] ^= table[a[7] ^ key[p + 6]];
    }
    for (let j = 0; j < 4; j++) {a[j + 4] ^= table[a[j] ^ key[56 + j]];}
    for (let j = 0; j < 8; j++) {
      const cipher = output[at + j]; output[at + j] = a[j] ^ (cbc ? previous[j] : 0); previous[j] = cipher;
    }
  }
  return output;
}
export function unpackMoleboxStage(input, signal) {
  requireMolebox(input.length >= 4);
  const size = input.readUInt32LE(0);
  requireMolebox(size > 0 && size <= moleboxLimits.stage, "RUNTIME_MOLEBOX_LIMIT");
  const output = Buffer.alloc(size); let at = 4, out = 0;
  while (out < size) {
    signal?.throwIfAborted(); requireMolebox(at + 2 <= input.length);
    const tag = input[at];
    if (tag === 128) {output[out++] = input[at + 1]; at += 2;}
    else if (tag === 0) {
      const count = input[at + 1] + 1; at += 2;
      requireMolebox(at + count <= input.length && out + count <= size);
      input.copy(output, out, at, at + count); at += count; out += count;
    } else {
      const word = input.readUInt16LE(at), count = word & 15, distance = (word >>> 4) + 15;
      requireMolebox(count > 0 && distance <= out && count <= distance && out + count <= size);
      output.copy(output, out, out - distance, out - distance + count); at += 2; out += count;
    }
  }
  // The shipped LZ decoder stops at the declared output length. Its compressor
  // leaves a short terminator/padding tail; it is not executable payload.
  requireMolebox(input.length - at <= 16);
  return output;
}
export function inflateMoleboxBlock(input, size) {
  try {
    const result = inflateSync(input, {maxOutputLength: size, info: true});
    requireMolebox(result.buffer.length === size && input.length - result.engine.bytesWritten < 8);
    return result.buffer;
  } catch {throw new Error("RUNTIME_MOLEBOX_INVALID");}
}
export function moleboxCRC16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {crc = (crc >>> 1) ^ (crc & 1 ? 0xa001 : 0);}
  }
  return crc;
}

