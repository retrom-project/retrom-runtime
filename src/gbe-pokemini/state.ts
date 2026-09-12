import {sha256} from "@noble/hashes/sha2.js";
export const stateLimit = 1024 * 1024;
export const stateFormat = "gbe-pokemini-state-v1";
const magic = new Uint8Array([71, 66, 69, 1]);
const invalid = () => new Error("GBE_CHECKPOINT_INVALID");
function identityBytes(identity: string) {
  if (!/^[a-f0-9]{64}$/u.test(identity)) {throw invalid();}
  return Uint8Array.from(identity.match(/../gu) ?? [], hex => parseInt(hex, 16));
}
export function encodeState(identity: string, state: Uint8Array) {
  if (!state.length || state.length + 68 > stateLimit) {throw invalid();}
  const bytes = new Uint8Array(68 + state.length);
  bytes.set(magic); bytes.set(identityBytes(identity), 4); bytes.set(sha256(state), 36); bytes.set(state, 68);
  return bytes;
}
export function decodeState(identity: string, bytes: Uint8Array) {
  if (bytes.length <= 68 || bytes.length > stateLimit || magic.some((v, i) => bytes[i] !== v) ||
    identityBytes(identity).some((v, i) => bytes[i + 4] !== v)) {throw invalid();}
  const state = bytes.slice(68);
  if (sha256(state).some((v, i) => bytes[i + 36] !== v)) {throw invalid();}
  return state;
}
