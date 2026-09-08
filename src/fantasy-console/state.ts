export type FantasyCore = "tic80" | "fake08";
const headerSize = 76;
const magic = {tic80: "RTTIC001", fake08: "RTF08001"};
export const checkpointFormats = {tic80: "tic80-pmem-v1", fake08: "fake08-state-v1"};
export const checkpointLimits = {tic80: 1100, fake08: 4 * 1024 * 1024 + headerSize};

export async function encodeState(core: FantasyCore, identity: string, payload: Uint8Array) {
  validatePayload(core, payload.byteLength);
  const result = new Uint8Array(headerSize + payload.byteLength);
  result.set(new TextEncoder().encode(magic[core]));
  result.set(digestBytes(identity), 8);
  result.set(await hash(payload), 40);
  new DataView(result.buffer).setUint32(72, payload.byteLength, true);
  result.set(payload, headerSize);
  return result;
}

export async function decodeState(core: FantasyCore, identity: string, state: Uint8Array) {
  if (state.byteLength < headerSize || state.byteLength > checkpointLimits[core] ||
      new TextDecoder().decode(state.subarray(0, 8)) !== magic[core] ||
      !equal(state.subarray(8, 40), digestBytes(identity))) {invalid();}
  const size = new DataView(state.buffer, state.byteOffset, state.byteLength).getUint32(72, true);
  validatePayload(core, size);
  if (size !== state.byteLength - headerSize) {invalid();}
  const payload = Uint8Array.from(state.subarray(headerSize));
  if (!equal(state.subarray(40, 72), await hash(payload))) {invalid();}
  return payload;
}

export async function hash(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
}
export async function verifyBytes(bytes: Uint8Array, size: number, sha256: string) {
  if (bytes.byteLength !== size || !equal(await hash(bytes), digestBytes(sha256))) {
    throw new Error("FANTASY_CONTENT_INTEGRITY_FAILED");
  }
}
function validatePayload(core: FantasyCore, size: number) {
  if (size < 1 || size + headerSize > checkpointLimits[core] || core === "tic80" && size !== 1024) {invalid();}
}
function digestBytes(value: string) {
  if (!/^[0-9a-f]{64}$/u.test(value)) {invalid();}
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => parseInt(pair, 16));
}
function equal(a: Uint8Array, b: Uint8Array) {return a.length === b.length && a.every((v, i) => v === b[i]);}
function invalid(): never {throw new Error("FANTASY_CHECKPOINT_INVALID");}
