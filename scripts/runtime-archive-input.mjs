import {createHash} from "node:crypto";
import {open} from "node:fs/promises";
import {decodeZIPName} from "../dist/content-io/zip-name.js";

export async function zipMembers(path) {
  const handle = await open(path, "r");
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
    const result = [], names = new Set(); let at = 0;
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
      if (!name.endsWith("/")) {result.push({name, sizeBytes: directory.readUInt32LE(at + 24), crc32: directory.readUInt32LE(at + 16).toString(16).padStart(8, "0")});}
      at += 46 + length + extra + comment;
    }
    if (at !== size) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
    return result;
  } finally {await handle.close();}
}
export function requireLocator(input, file) {
  const path = input.locators?.[file.logicalKey];
  if (typeof path !== "string" || !path.startsWith("/")) {throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");}
  return path;
}
export function safePath(path) {return typeof path === "string" && path.length > 0 && path.length <= 4096 && !path.startsWith("/") &&
  !path.includes("\\") && [...path].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
  path.split("/").every(part => part && part !== "." && part !== "..");}
export function sha256(bytes) {return createHash("sha256").update(bytes).digest("hex");}
