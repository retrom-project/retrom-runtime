import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex, hexToBytes} from "@noble/hashes/utils.js";
export const checkpointLimit = 64 * 1024 * 1024;
export const checkpointFormat = "mame-state-v1";
const headerSize = 108;
const magic = new TextEncoder().encode("RTMAME01");
export async function encodeState(identity: string, build: string, payload: Uint8Array) {
  validateSize(payload.length); validateIdentity(identity); validateIdentity(build);
  const result = new Uint8Array(headerSize + payload.length);
  result.set(magic); result.set(hexToBytes(identity), 8); result.set(hexToBytes(build), 40);
  result.set(sha256(payload), 72); new DataView(result.buffer).setUint32(104, payload.length, true);
  result.set(payload, headerSize); return result;
}
export async function decodeState(identity: string, build: string, state: Uint8Array) {
  validateSize(state.length - headerSize); validateIdentity(identity); validateIdentity(build);
  if (!magic.every((v, i) => state[i] === v) || bytesToHex(state.subarray(8, 40)) !== identity ||
    bytesToHex(state.subarray(40, 72)) !== build || new DataView(state.buffer, state.byteOffset, state.byteLength).getUint32(104, true) !== state.length - headerSize) {invalid();}
  const payload = Uint8Array.from(state.subarray(headerSize));
  if (!sha256(payload).every((v, i) => v === state[72 + i])) {invalid();}
  return payload;
}
function validateSize(size: number) {if (size < 1 || size + headerSize > checkpointLimit) {invalid();}}
function validateIdentity(value: string) {if (!/^[0-9a-f]{64}$/u.test(value)) {invalid();}}
function invalid(): never {throw new Error("MAME_CHECKPOINT_INVALID");}
