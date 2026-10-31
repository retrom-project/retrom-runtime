import {openContent, contentStream} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {mkdir} from "node:fs/promises";
import {createWriteStream} from "node:fs";
import {createHash} from "node:crypto";
import {createInflateRaw, crc32} from "node:zlib";
import {pipeline} from "node:stream/promises";
import {Transform} from "node:stream";
import {join, dirname} from "node:path";

const maximumHeader = 16 * 1024 * 1024, maximumTree = 16 * 1024 ** 3;
const hasWebEntry = input => input.files.some(file => /(?:^|\/)index\.html$/iu.test(file.logicalKey));
async function signature(locator, bytes) {
  if (locator.sizeBytes < bytes.length) {return false;}
  const file = await openContent(locator);
  try {return (await readAt(file, 0, bytes.length)).equals(bytes);} finally {await file.close();}
}
async function hasZIP(locator) {
  if (locator.sizeBytes < 22) {return false;}
  const file = await openContent(locator);
  try {
    const size = Math.min(locator.sizeBytes, 65557), tail = await readAt(file, locator.sizeBytes - size, size);
    for (let at = tail.length - 22; at >= 0; at--) {
      if (tail.readUInt32LE(at) === 0x06054b50 && at + 22 + tail.readUInt16LE(at + 20) === tail.length) {return true;}
    }
    return false;
  } finally {await file.close();}
}
async function probeAsar(input) {
  if (hasWebEntry(input)) {return [];}
  const plans = [];
  for (const file of input.files.filter(file => /(?:^|\/)app\.asar$/iu.test(file.logicalKey))) {
    const source = requireLocator(input, file);
    if (!await signature(source, Buffer.from([4, 0, 0, 0]))) {continue;}
    const rows = await asarEntries(source, file.sizeBytes, input, file.logicalKey);
    if (!rows.some(row => row.logicalKey === "index.html")) {throw new Error("RUNTIME_ENTRY_MISSING");}
    plans.push({format: "electron-asar", launchDomain: file.logicalKey, claims: [file.logicalKey, ...rows.filter(row => row.sourceKey).map(row => row.sourceKey)],
      outputs: rows.map(row => row.logicalKey), file, rows});
  }
  return plans;
}
async function probeZIP(input) {
  if (hasWebEntry(input)) {return [];}
  const plans = [];
  for (const file of input.files.filter(file => /\.exe$/iu.test(file.logicalKey))) {
    const source = requireLocator(input, file);
    if (!await signature(source, Buffer.from("MZ")) || !await hasZIP(source)) {continue;}
    const rows = await embeddedZIPEntries(source, file.sizeBytes);
    if (!rows.some(row => row.logicalKey === "index.html")) {continue;}
    plans.push({format: "nw-embedded-zip", launchDomain: file.logicalKey, claims: [file.logicalKey], outputs: rows.map(row => row.logicalKey), file, rows});
  }
  return plans;
}
async function convert(input, plan) {
  const {signal} = input, source = requireLocator(input, plan.file), sourceHash = createHash("sha256");
  for await (const chunk of contentStream(source, {signal})) {sourceHash.update(chunk);}
  if (sourceHash.digest("hex") !== plan.file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  const files = []; let total = 0;
  for (const row of plan.rows) {
    signal?.throwIfAborted(); total += row.sizeBytes;
    if (total > maximumTree) {throw new Error("RUNTIME_PROJECT_TOO_LARGE");}
    const path = join(input.outputRoot, row.logicalKey); await mkdir(dirname(path), {recursive: true});
    const hash = createHash("sha256"); let length = 0, checksum = 0;
    const verify = new Transform({transform(chunk, _, callback) {
      length += chunk.length;
      if (length > row.sizeBytes) {callback(new Error("RUNTIME_CONTENT_CHANGED")); return;}
      hash.update(chunk); checksum = crc32(chunk, checksum); callback(null, chunk);
    }});
    const destination = createWriteStream(path, {flags: "wx", mode: 0o600});
    const reader = contentStream(row.sourceKey ? input.locators[row.sourceKey] : source,
      {start: row.offset, length: row.compressedBytes, signal});
    if (row.deflate) {await pipeline(reader, createInflateRaw(), verify, destination, {signal});}
    else {await pipeline(reader, verify, destination, {signal});}
    const digest = hash.digest("hex");
    if (length !== row.sizeBytes || row.crc32 !== undefined && checksum !== row.crc32 || row.expectedSHA256 && row.expectedSHA256 !== digest) {
      throw new Error("RUNTIME_CONTENT_CHANGED");
    }
    files.push({logicalKey: row.logicalKey, name: row.logicalKey, sizeBytes: length, sha256: digest, path});
  }
  const finalHash = createHash("sha256");
  for await (const chunk of contentStream(source, {signal})) {finalHash.update(chunk);}
  if (finalHash.digest("hex") !== plan.file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  return {files, summary: {archiveCount: 1, verifiedEntries: files.length}};
}
export const electronAsar = Object.freeze({id: "electron-asar", phase: "container", version: 1, priority: 200, platforms: ["tyranoscript"],
  formats: ["electron-asar"], probe: probeAsar, convert});
export const nwEmbeddedZip = Object.freeze({id: "nw-embedded-zip", phase: "container", version: 1, priority: 300, platforms: ["tyranoscript"],
  formats: ["nw-embedded-zip"], probe: probeZIP, convert});

async function asarEntries(path, size, input, sourceKey) {
  const file = await openContent(path);
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
          if (!sidecar || sidecar.sizeBytes !== node.size || !input.locators?.[sidecarKey] || input.locators[sidecarKey].sizeBytes !== sidecar.sizeBytes) {throw new Error("RUNTIME_ASAR_SIDECAR_MISSING");}
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
  const file = await openContent(path);
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
