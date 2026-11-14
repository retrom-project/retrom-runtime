import {ContentIOError} from "../content-io/errors.js";
import {record} from "../content-io/source.js";

const imageHeader = [82, 80, 71, 77, 86, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0];
const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];

export function mvImageKey(bytes: Uint8Array): Uint8Array | null {
  let system: unknown;
  try {system = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));}
  catch {throw invalid();}
  if (!record(system)) {throw invalid();}
  if (system.hasEncryptedImages !== true) {return null;}
  if (typeof system.encryptionKey !== "string" || !/^[0-9a-f]{32}$/iu.test(system.encryptionKey)) {throw invalid();}
  const key = system.encryptionKey;
  return Uint8Array.from({length: 16}, (_, index) => parseInt(key.slice(index * 2, index * 2 + 2), 16));
}

/** MV encrypts the first 16 payload bytes after its separate 16-byte header. */
export function decodeMvImage(bytes: Uint8Array, key: Uint8Array, offset: number): Uint8Array {
  for (let i = 0; i < bytes.length && offset + i < 16; i++) {bytes[i] = bytes[i]! ^ key[offset + i]!;}
  return bytes;
}

export function validateMvImage(bytes: Uint8Array, key: Uint8Array): void {
  if (bytes.length !== 32 || !imageHeader.every((byte, index) => bytes[index] === byte)) {throw invalid();}
  const png = decodeMvImage(bytes.subarray(16), key, 0);
  if (!pngHeader.every((byte, index) => png[index] === byte)) {throw invalid();}
}

function invalid() {return new ContentIOError("SOURCE_INVALID");}
