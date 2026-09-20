export const BLOCK_BYTES = 262144;
export function byteAt(position, seed = 17) {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(seed) || seed < 0 || seed > 255) {
    throw new RangeError("FIXTURE_ARGUMENT_INVALID");
  }
  return (position % 251 + 17 * (Math.floor(position / 251) % 251) +
    31 * (Math.floor(position / 65536) % 251) + seed) % 256;
}
export function fixtureBytes(offset, length, seed = 17) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
    length > BLOCK_BYTES || offset > Number.MAX_SAFE_INTEGER - length) {throw new RangeError("FIXTURE_ARGUMENT_INVALID");}
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index++) {out[index] = byteAt(offset + index, seed);}
  return out;
}
export const sizes = Object.freeze({zero: 0, one: 1, "below-block": 262143, "exact-block": 262144,
  "above-block": 262145, "below-small": 1048575, "exact-small": 1048576, "above-small": 1048577, "multi-tail": 786449, "max-eager": 536870912, "cache-trace": 20971537, "big-offset": 5368709243});
