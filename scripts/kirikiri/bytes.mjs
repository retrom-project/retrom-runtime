import {createHash} from "node:crypto";
import {inflateSync, createInflate} from "node:zlib";
import {openContent, contentStream} from "../runtime-host-content.mjs";

export const magic = Buffer.from("5850330d0a200a1a8b6701", "hex");
export const maximumIndex = 32 * 1024 * 1024;
export const maximumFile = 8 * 1024 ** 3;
export const maximumTree = 64 * 1024 ** 3;
export function requireFormat(value, code = "ARCHIVE_INVALID") {
  if (!value) {throw new Error(`RUNTIME_KIRIKIRI_${code}`);}
}
export function number64(bytes, at = 0) {
  requireFormat(at >= 0 && at + 8 <= bytes.length);
  const value = bytes.readBigUInt64LE(at);
  requireFormat(value <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(value);
}
export function uint64(value) {const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes;}
export function chunk(tag, bytes) {return Buffer.concat([Buffer.from(tag, "ascii"), uint64(bytes.length), bytes]);}
export function* chunks(bytes, onTag) {
  for (let at = 0; at < bytes.length;) {
    if (at + 4 <= bytes.length) {onTag?.(bytes.toString("ascii", at, at + 4));}
    requireFormat(at + 12 <= bytes.length);
    const length = number64(bytes, at + 4), start = at + 12;
    requireFormat(length <= bytes.length - start);
    yield {tag: bytes.toString("ascii", at, at + 4), bytes: bytes.subarray(start, start + length)};
    at = start + length;
  }
}
export async function readExact(handle, at, size) {
  const info = await handle.stat();
  requireFormat(Number.isSafeInteger(at) && Number.isSafeInteger(size) && at >= 0 && size >= 0 && at <= info.size && size <= info.size - at);
  const bytes = Buffer.alloc(size);
  for (let filled = 0; filled < size;) {
    const {bytesRead} = await handle.read(bytes, filled, size - filled, at + filled);
    requireFormat(bytesRead > 0); filled += bytesRead;
  }
  return bytes;
}
export function inflate(bytes, size) {
  requireFormat(size >= 0 && size <= maximumIndex && bytes.length <= maximumIndex);
  let result;
  try {result = inflateSync(bytes, {info: true, maxOutputLength: Math.max(1, size + 1)});}
  catch {throw new Error("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");}
  requireFormat(result.buffer.length === size && result.engine.bytesWritten === bytes.length);
  return result.buffer;
}
export function text16(bytes, start, count, {empty = false} = {}) {
  requireFormat((empty || count > 0) && count <= 32767 && start + count * 2 <= bytes.length);
  const end = start + count * 2, tail = bytes.subarray(end);
  requireFormat(tail.length === 0 || tail.length === 2 && tail.readUInt16LE() === 0);
  let name;
  try {name = new TextDecoder("utf-16le", {fatal: true, ignoreBOM: true}).decode(bytes.subarray(start, end));}
  catch {throw new Error("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");}
  requireFormat(!name.includes("\0")); return name;
}
export function normalizeName(name) {return name.replace(/[A-Z]/gu, c => c.toLowerCase()).replace(/\\/gu, "/").replace(/\/+/gu, "/").replace(/^\//u, "");}
export function safeName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 4096 && !/[:\\]/u.test(name) &&
    [...name].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
    !name.startsWith("/") && name.split("/").every(part => part && part !== "." && part !== "..");
}
export function adler32(bytes, previous = 1) {
  let a = previous & 65535, b = previous >>> 16;
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(bytes.length, start + 5552);
    for (let i = start; i < end; i++) {a += bytes[i]; b += a;}
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
export async function sourceHash(locator, signal) {
  const digest = createHash("sha256");
  for await (const bytes of contentStream(locator, {signal})) {digest.update(bytes);}
  return digest.digest("hex");
}
export async function* resourceBytes(locator, entry, signal) {
  for (const segment of entry.segments) {
    const source = contentStream(locator, {start: segment.offset, length: segment.packed, signal});
    const decoder = segment.mode ? createInflate() : null, stream = decoder ? source.pipe(decoder) : source;
    const forward = error => stream.destroy(error);
    if (decoder) {source.on("error", forward);}
    let size = 0;
    try {
      for await (const bytes of stream) {
        signal?.throwIfAborted(); size += bytes.length;
        requireFormat(size <= segment.expanded); yield bytes;
      }
      requireFormat(size === segment.expanded && (!decoder || decoder.bytesWritten === segment.packed));
    } catch (error) {
      if (signal?.aborted || error.message?.startsWith("RUNTIME_")) {throw error;}
      throw new Error("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");
    } finally {source.removeListener("error", forward); source.destroy(); stream.destroy();}
  }
}
export async function signature(locator) {
  if (locator.sizeBytes < magic.length) {return false;}
  const handle = await openContent(locator);
  try {return (await readExact(handle, 0, magic.length)).equals(magic);}
  finally {await handle.close();}
}
