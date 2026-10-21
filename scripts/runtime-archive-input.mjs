import {createHash} from "node:crypto";
import {openContent} from "./runtime-host-content.mjs";
import {crc32, createInflateRaw} from "node:zlib";
import {Readable} from "node:stream";
import {decodeZIPName} from "../dist/content-io/zip-name.js";

export async function zipMembers(path, {digests = false} = {}) {
  const handle = await openContent(path);
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, 65557), tail = Buffer.alloc(length);
    await handle.read(tail, 0, length, info.size - length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {if (tail.readUInt32LE(i) === 0x06054b50) {end = i; break;}}
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
    const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || size > 64 * 1024 * 1024 || offset + size > info.size) {throw new Error("RUNTIME_ARCHIVE_LIMIT");}
    const directory = Buffer.alloc(size); await handle.read(directory, 0, size, offset);
    const result = [], names = new Set(); let at = 0, expanded = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > size || directory.readUInt32LE(at) !== 0x02014b50 || directory.readUInt16LE(at + 8) & 1) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
      const length = directory.readUInt16LE(at + 28), extra = directory.readUInt16LE(at + 30), comment = directory.readUInt16LE(at + 32);
      if (at + 46 + length + extra + comment > size) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
      let name;
      try {name = decodeZIPName(directory.subarray(at + 46, at + 46 + length), directory.readUInt16LE(at + 8),
        directory.subarray(at + 46 + length, at + 46 + length + extra));}
      catch {throw new Error("RUNTIME_ARCHIVE_INVALID");}
      if (!safePath(name.replace(/\/$/u, "")) || names.has(name)) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
      names.add(name);
      if (!name.endsWith("/")) {
        const member = {name, sizeBytes: directory.readUInt32LE(at + 24), crc32: directory.readUInt32LE(at + 16).toString(16).padStart(8, "0")};
        if (digests) {
          expanded += member.sizeBytes;
          if (expanded > 512 * 1024 * 1024) {throw new Error("RUNTIME_ARCHIVE_LIMIT");}
          Object.assign(member, await memberDigests(handle, directory, at, member, offset));
        }
        result.push(member);
      }
      at += 46 + length + extra + comment;
    }
    if (at !== size) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
    return result;
  } finally {await handle.close();}
}

/** Hash inflated members in bounded chunks; never trust a central-directory CRC as content evidence. */
async function memberDigests(handle, directory, at, member, directoryOffset) {
  const method = directory.readUInt16LE(at + 10), compressed = directory.readUInt32LE(at + 20),
    offset = directory.readUInt32LE(at + 42), header = Buffer.alloc(30);
  const {bytesRead} = await handle.read(header, 0, header.length, offset);
  if (bytesRead !== 30 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) & 1 ||
    header.readUInt16LE(8) !== method || ![0, 8].includes(method)) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
  const start = offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (start > directoryOffset || compressed > directoryOffset - start) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
  const hashes = {sha1: createHash("sha1"), sha256: createHash("sha256")};
  let size = 0, crc = 0;
  if (compressed) {
    const source = Readable.from(compressedChunks(handle, start, compressed));
    const stream = method === 8 ? source.pipe(createInflateRaw()) : source;
    const forwardError = error => stream.destroy(error);
    if (stream !== source) {source.on("error", forwardError);}
    try {
      for await (const bytes of stream) {
        size += bytes.length;
        if (size > member.sizeBytes) {throw new Error("RUNTIME_ARCHIVE_LIMIT");}
        crc = crc32(bytes, crc); hashes.sha1.update(bytes); hashes.sha256.update(bytes);
      }
    } finally {source.removeListener("error", forwardError); source.destroy(); stream.destroy();}
  }
  if (size !== member.sizeBytes || crc.toString(16).padStart(8, "0") !== member.crc32) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
  return {sha1: hashes.sha1.digest("hex"), sha256: hashes.sha256.digest("hex")};
}
async function* compressedChunks(handle, start, length) {
  for (let offset = 0; offset < length;) {
    const bytes = Buffer.alloc(Math.min(65536, length - offset));
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, start + offset);
    if (bytesRead !== bytes.length) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
    offset += bytesRead; yield bytes;
  }
}
export function requireLocator(input, file) {
  const locator = input.locators?.[file.logicalKey];
  if (!locator || typeof locator.path !== "string" || !locator.path.startsWith("/") ||
    !Number.isSafeInteger(locator.offset) || locator.offset < 0 || !Number.isSafeInteger(locator.sizeBytes) ||
    !Number.isSafeInteger(locator.offset + locator.sizeBytes)) {throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");}
  if (locator.sizeBytes !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  return locator;
}
export function safePath(path) {return typeof path === "string" && path.length > 0 && path.length <= 4096 && !path.startsWith("/") &&
  !path.includes("\\") && [...path].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
  path.split("/").every(part => part && part !== "." && part !== "..");}
export function sha256(bytes) {return createHash("sha256").update(bytes).digest("hex");}
