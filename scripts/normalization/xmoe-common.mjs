export const xmoeLimits = Object.freeze({image: 32 * 1024 * 1024, index: 16 * 1024 * 1024,
  file: 128 * 1024 * 1024, tree: 8 * 1024 ** 3, entries: 100000, name: 4096});
export function requireXmoe(value, code = "RUNTIME_XMOE_INVALID") {if (!value) {throw new Error(code);}}
export function xmoeRange(bytes, start, length) {
  requireXmoe(Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length >= 0 &&
    start <= bytes.length && length <= bytes.length - start);
  return bytes.subarray(start, start + length);
}
export function xmoeName(bytes) {
  requireXmoe(bytes.length > 0 && bytes.length <= 2 * xmoeLimits.name && bytes.length % 2 === 0);
  let name;
  try {name = new TextDecoder("utf-16le", {fatal: true}).decode(bytes);} catch {throw new Error("RUNTIME_XMOE_INVALID");}
  requireXmoe(name !== "." && name !== ".." && !/[/\\>:]/u.test(name) && !Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), "RUNTIME_XMOE_PATH_INVALID");
  return name;
}
export function xmoeNameHash(bytes, seed) {
  const m = 0x5bd1e995, mul = value => Math.imul(value, m) >>> 0;
  const mix = value => {value = mul(value); return mul(value ^ (value >>> 24));};
  let h1 = (seed ^ bytes.length) >>> 0, h2 = 0, at = 0;
  for (; at + 8 <= bytes.length; at += 8) {h1 = (mul(h1) ^ mix(bytes.readUInt32LE(at))) >>> 0; h2 = (mul(h2) ^ mix(bytes.readUInt32LE(at + 4))) >>> 0;}
  if (at + 4 <= bytes.length) {h1 = (mul(h1) ^ mix(bytes.readUInt32LE(at))) >>> 0; at += 4;}
  if (at < bytes.length) {let tail = 0; for (let i = 0; at + i < bytes.length; i++) {tail |= bytes[at + i] << (i * 8);} h2 = mul(h2 ^ tail);}
  h1 = mul(h1 ^ (h2 >>> 18)); h2 = mul(h2 ^ (h1 >>> 22)); h1 = mul(h1 ^ (h2 >>> 17)); h2 = mul(h2 ^ (h1 >>> 19));
  return (BigInt(h1) << 32n) | BigInt(h2);
}
