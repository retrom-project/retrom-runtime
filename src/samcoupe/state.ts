import {sha256} from "@noble/hashes/sha2.js";

export const maxDiskBytes = 16 * 1024 * 1024;
export const saveFormat = "samcoupe-disk-save-v1";
const magic = new TextEncoder().encode("RETROM_SAM_DISK_V1\0");
const headerBytes = magic.length + 32 + 32 + 4;

function gameDigest(hex: string) {
  if (!/^[0-9a-f]{64}$/u.test(hex)) {throw new Error("SAMCOUPE_SAVE_INVALID");}
  return Uint8Array.from(hex.match(/../gu)!, value => Number.parseInt(value, 16));
}

export function encodeSamDisk(gameSha256: string, disk: Uint8Array) {
  if (!disk.byteLength || disk.byteLength > maxDiskBytes) {throw new Error("SAMCOUPE_SAVE_INVALID");}
  const result = new Uint8Array(headerBytes + disk.byteLength);
  result.set(magic);
  result.set(gameDigest(gameSha256), magic.length);
  result.set(sha256(disk), magic.length + 32);
  new DataView(result.buffer).setUint32(magic.length + 64, disk.byteLength, true);
  result.set(disk, headerBytes);
  return result;
}

export function decodeSamDisk(gameSha256: string, encoded: Uint8Array) {
  if (!(encoded instanceof Uint8Array) || encoded.byteLength <= headerBytes ||
    encoded.byteLength > headerBytes + maxDiskBytes ||
    !magic.every((value, index) => encoded[index] === value) ||
    !gameDigest(gameSha256).every((value, index) => encoded[magic.length + index] === value)) {
    throw new Error("SAMCOUPE_SAVE_INVALID");
  }
  const size = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(magic.length + 64, true);
  const disk = encoded.subarray(headerBytes);
  if (size !== disk.byteLength || !sha256(disk).every((value, index) =>
    encoded[magic.length + 32 + index] === value)) {throw new Error("SAMCOUPE_SAVE_INVALID");}
  return new Uint8Array(disk);
}
