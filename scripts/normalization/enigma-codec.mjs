export const enigmaLimits = Object.freeze({metadata: 8 * 1024 * 1024, bootstrap: 1024 * 1024,
  entries: 100000, file: 8 * 1024 ** 3, tree: 64 * 1024 ** 3});
export function requireEnigma(value, code = "INVALID") {if (!value) {throw new Error("RUNTIME_ENIGMA_" + code);}}
export function enigmaRange(bytes, at, length) {
  requireEnigma(Number.isSafeInteger(at) && Number.isSafeInteger(length) && at >= 0 && length >= 0 && length <= bytes.length - at);
  return bytes.subarray(at, at + length);
}
export function enigmaNumber(bytes, at) {
  const value = enigmaRange(bytes, at, 8).readBigUInt64LE();
  requireEnigma(value <= BigInt(Number.MAX_SAFE_INTEGER)); return Number(value);
}
export async function readEnigma(handle, size, at, length, signal) {
  signal?.throwIfAborted();
  requireEnigma(Number.isSafeInteger(at) && Number.isSafeInteger(length) && at >= 0 && length >= 0 && length <= size - at);
  const bytes = Buffer.alloc(length); let filled = 0;
  while (filled < length) {
    signal?.throwIfAborted(); const result = await handle.read(bytes, filled, length - filled, at + filled);
    requireEnigma(result.bytesRead > 0); filled += result.bytesRead;
  }
  return bytes;
}
export function enigmaSchedule(key) {
  requireEnigma(key.length > 0 && key.length <= 256);
  const state = Uint8Array.from({length: 256}, (_, i) => i); let j = 0;
  for (let i = 0; i < 256; i++) {j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]];}
  return state;
}
// The package stores a complete initial PRGA state, not an RC4 password.
// The native reader copies it and resets both indices for every record/block.
export function enigmaCrypt(bytes, initial) {
  if (!initial) {return bytes;}
  requireEnigma(initial.length === 256);
  const state = Uint8Array.from(initial), out = Buffer.alloc(bytes.length); let i = 0, j = 0;
  for (let p = 0; p < bytes.length; p++) {
    i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]];
    out[p] = bytes[p] ^ state[(state[i] + state[j]) & 255];
  }
  return out;
}
/** Bounded aPLib stream with explicit output and input termination checks. */
export function enigmaDepack(input, size, signal, {dwordPadding = false} = {}) {
  requireEnigma(size > 0 && size <= enigmaLimits.metadata, "LIMIT");
  const out = Buffer.alloc(size); let at = 0, count = 0, tag = 0, bits = 0, previous = 0, lwm = 0;
  const byte = () => {requireEnigma(at < input.length); return input[at++];};
  const bit = () => {
    if (!bits) {tag = byte(); bits = 8;}
    const value = tag >>> 7; tag = (tag << 1) & 255; bits--; return value;
  };
  const gamma = () => {
    let value = 1;
    do {value = value * 2 + bit(); requireEnigma(value <= 0x7fffffff, "LIMIT");} while (bit());
    return value;
  };
  const copy = (distance, length) => {
    requireEnigma(distance > 0 && distance <= count && length > 0 && length <= size - count);
    for (let n = 0; n < length; n++) {out[count] = out[count - distance]; count++;}
  };
  out[count++] = byte();
  for (let operations = 0; ; operations++) {
    if (!(operations & 4095)) {signal?.throwIfAborted();}
    requireEnigma(operations < size * 2 + 16, "LIMIT");
    if (!bit()) {requireEnigma(count < size); out[count++] = byte(); lwm = 0; continue;}
    if (!bit()) {
      let distance = gamma() - (lwm ? 1 : 2), length;
      if (!distance) {distance = previous; length = gamma();}
      else {
        requireEnigma(distance > 0); distance = (distance - 1) * 256 + byte(); length = gamma();
        if (distance >= 32000) {length++;} if (distance >= 1280) {length++;} if (distance < 128) {length += 2;}
        previous = distance;
      }
      copy(distance, length); lwm = 1; continue;
    }
    if (!bit()) {
      const value = byte(), distance = value >>> 1;
      if (!distance) {
        // Only the bootstrap XOR loop rounds its compressed input to DWORDs.
        // Configurations and VFS blocks retain exact stream termination.
        const padded = dwordPadding && input.length % 4 === 0 && input.length - at < 4 && input.subarray(at).every(v => v === 0);
        requireEnigma(count === size && (at === input.length || padded)); return out;
      }
      copy(distance, 2 + (value & 1)); previous = distance; lwm = 1; continue;
    }
    let distance = 0; for (let n = 0; n < 4; n++) {distance = distance * 2 + bit();}
    requireEnigma(count < size && distance <= count);
    out[count] = distance ? out[count - distance] : 0; count++; lwm = 0;
  }
}
