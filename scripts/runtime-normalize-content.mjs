import {open, mkdir, lstat, rm} from "node:fs/promises";
import {createReadStream, createWriteStream} from "node:fs";
import {createHash} from "node:crypto";
import {createInflateRaw, crc32} from "node:zlib";
import {pipeline} from "node:stream/promises";
import {Transform} from "node:stream";
import {join, dirname} from "node:path";
import {contentHash} from "../dist/runtime/index.js";

const maximumHeader = 16 * 1024 * 1024, maximumTree = 16 * 1024 * 1024 * 1024;
/** Normalize retained project containers into ordinary immutable game files, never executable processes. */
export async function normalizeContent(input) {
  contentHash(input.files, "TREE");
  if (input.platformId !== "tyranoscript" || input.files.some(file => /(?:^|\/)index\.html$/iu.test(file.logicalKey))) {return {files: input.files};}
  const asar = input.files.filter(file => /(?:^|\/)app\.asar$/iu.test(file.logicalKey));
  const executables = input.files.filter(file => /\.exe$/iu.test(file.logicalKey));
  const selected = asar.length === 1 ? asar[0] : executables.length === 1 ? executables[0] : null;
  if (!selected) {throw new Error("RUNTIME_PROJECT_CONTAINER_AMBIGUOUS");}
  const source = input.locators?.[selected.logicalKey];
  if (typeof source !== "string" || !source.startsWith("/") || typeof input.outputRoot !== "string" || !input.outputRoot.startsWith("/")) {throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");}
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== selected.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  const rows = asar.length ? await asarEntries(source, info.size, input, selected.logicalKey) : await embeddedZIPEntries(source, info.size);
  if (!rows.some(row => row.logicalKey === "index.html")) {throw new Error("RUNTIME_ENTRY_MISSING");}
  const sourceHash = createHash("sha256");
  for await (const chunk of createReadStream(source)) {sourceHash.update(chunk);}
  if (sourceHash.digest("hex") !== selected.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  const files = []; let total = 0;
  await mkdir(input.outputRoot, {recursive: false, mode: 0o700});
  try {
    for (const row of rows) {
      total += row.sizeBytes;
      if (total > maximumTree) {throw new Error("RUNTIME_PROJECT_TOO_LARGE");}
      const path = join(input.outputRoot, row.logicalKey); await mkdir(dirname(path), {recursive: true});
      const hash = createHash("sha256"); let length = 0, checksum = 0;
      const verify = new Transform({transform(chunk, _, callback) {
        length += chunk.length;
        if (length > row.sizeBytes) {callback(new Error("RUNTIME_CONTENT_CHANGED")); return;}
        hash.update(chunk); checksum = crc32(chunk, checksum); callback(null, chunk);
      }});
      const destination = createWriteStream(path, {flags: "wx", mode: 0o600});
      if (row.compressedBytes === 0) {destination.end(); await new Promise((complete, reject) => {destination.on("finish", complete); destination.on("error", reject);});}
      else {
        const reader = createReadStream(row.sourceKey ? input.locators[row.sourceKey] : source, {start: row.offset, end: row.offset + row.compressedBytes - 1});
        if (row.deflate) {await pipeline(reader, createInflateRaw(), verify, destination);} else {await pipeline(reader, verify, destination);}
      }
      const digest = hash.digest("hex");
      if (length !== row.sizeBytes || row.crc32 !== undefined && checksum !== row.crc32 || row.expectedSHA256 && row.expectedSHA256 !== digest) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      files.push({logicalKey: row.logicalKey, name: row.logicalKey, sizeBytes: length, sha256: digest, path});
    }
    return {files};
  } catch (error) {await rm(input.outputRoot, {recursive: true, force: true}); throw error;}
}

async function asarEntries(path, size, input, sourceKey) {
  const file = await open(path, "r");
  try {
    const prefix = await readAt(file, 0, 16);
    const headerBytes = prefix.readUInt32LE(4), payloadBytes = prefix.readUInt32LE(8), jsonBytes = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || headerBytes !== payloadBytes + 4 || payloadBytes < 4 || headerBytes > maximumHeader || jsonBytes > payloadBytes - 4) {throw new Error("RUNTIME_ASAR_INVALID");}
    const header = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(await readAt(file, 16, jsonBytes)));
    const start = 8 + headerBytes, result = [], folded = new Set();
    function collect(value, root = "", depth = 0, unpacked = false) {
      if (!value || typeof value !== "object" || !value.files || depth > 32) {throw new Error("RUNTIME_ASAR_INVALID");}
      for (const [name, node] of Object.entries(value.files)) {
        const key = root + name;
        if (!safePath(key) || result.length >= 100000 || !node || typeof node !== "object" || node.link) {throw new Error("RUNTIME_ASAR_INVALID");}
        if (node.files) {collect(node, `${key}/`, depth + 1, unpacked || node.unpacked === true); continue;}
        if (unpacked || node.unpacked === true) {
          const sidecarKey = `${sourceKey}.unpacked/${key}`, sidecar = input.files.find(file => file.logicalKey === sidecarKey);
          if (!sidecar || sidecar.sizeBytes !== node.size || typeof input.locators?.[sidecarKey] !== "string" || !input.locators[sidecarKey].startsWith("/")) {throw new Error("RUNTIME_ASAR_SIDECAR_MISSING");}
          result.push({logicalKey: key, sourceKey: sidecarKey, offset: 0, compressedBytes: node.size, sizeBytes: node.size, deflate: false, expectedSHA256: sidecar.sha256}); continue;
        }
        const offset = typeof node.offset === "string" && /^\d+$/u.test(node.offset) ? Number(node.offset) : NaN;
        if (!Number.isSafeInteger(node.size) || node.size < 0 || !Number.isSafeInteger(offset) || offset < 0 || start + offset + node.size > size || folded.has(key.toLowerCase())) {throw new Error("RUNTIME_ASAR_INVALID");}
        folded.add(key.toLowerCase()); result.push({logicalKey: key, offset: start + offset, compressedBytes: node.size, sizeBytes: node.size, deflate: false});
      }
    }
    collect(header); return validateRows(result);
  } finally {await file.close();}
}

async function embeddedZIPEntries(path, size) {
  const file = await open(path, "r");
  try {
    const length = Math.min(size, 65557), tail = await readAt(file, size - length, length);
    let end = -1;
    for (let at = tail.length - 22; at >= 0; at--) {if (tail.readUInt32LE(at) === 0x06054b50 && at + 22 + tail.readUInt16LE(at + 20) === tail.length) {end = at; break;}}
    if (end < 0 || tail.readUInt32LE(end + 4) !== 0) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
    const count = tail.readUInt16LE(end + 10), bytes = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || count !== tail.readUInt16LE(end + 8) || bytes > maximumHeader) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
    const prefix = size - length + end - bytes - offset;
    if (prefix < 0) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
    const directory = await readAt(file, prefix + offset, bytes), rows = []; let at = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > bytes || directory.readUInt32LE(at) !== 0x02014b50 || directory.readUInt16LE(at + 8) & 1) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
      const nameBytes = directory.readUInt16LE(at + 28), extra = directory.readUInt16LE(at + 30), comment = directory.readUInt16LE(at + 32);
      const name = new TextDecoder("utf-8", {fatal: true}).decode(directory.subarray(at + 46, at + 46 + nameBytes));
      if (!safePath(name.replace(/\/$/u, ""))) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
      if (!name.endsWith("/")) {
        const method = directory.readUInt16LE(at + 10), localOffset = prefix + directory.readUInt32LE(at + 42), local = await readAt(file, localOffset, 30);
        if (![0, 8].includes(method) || local.readUInt32LE(0) !== 0x04034b50 || ((directory.readUInt32LE(at + 38) >>> 16) & 0xf000) === 0xa000) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
        const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), compressed = directory.readUInt32LE(at + 20);
        if (dataOffset + compressed > prefix + offset) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
        rows.push({logicalKey: name, offset: dataOffset, compressedBytes: compressed, sizeBytes: directory.readUInt32LE(at + 24), crc32: directory.readUInt32LE(at + 16), deflate: method === 8});
      }
      at += 46 + nameBytes + extra + comment;
    }
    if (at !== bytes) {throw new Error("RUNTIME_EMBEDDED_ZIP_INVALID");}
    return validateRows(rows);
  } finally {await file.close();}
}
function validateRows(rows) {
  const sorted = rows.filter(row => !row.sourceKey).sort((a, b) => a.offset - b.offset);
  if (rows.length === 0 || rows.some(row => !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) || new Set(rows.map(row => row.logicalKey.toLowerCase())).size !== rows.length || sorted.some((row, index) => index && row.offset < sorted[index - 1].offset + sorted[index - 1].compressedBytes)) {throw new Error("RUNTIME_PROJECT_CONTAINER_INVALID");}
  return rows.sort((a, b) => Buffer.from(a.logicalKey).compare(Buffer.from(b.logicalKey)));
}
async function readAt(handle, offset, size) {
  const buffer = Buffer.alloc(size); let read = 0;
  while (read < size) {const result = await handle.read(buffer, read, size - read, offset + read); if (!result.bytesRead) {throw new Error("RUNTIME_PROJECT_CONTAINER_INVALID");} read += result.bytesRead;}
  return buffer;
}
function safePath(path) {return typeof path === "string" && path.length > 0 && path.length <= 4096 && !path.includes("\\") &&
  [...path].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) && path.split("/").every(part => part && part !== "." && part !== "..");}
