import {open} from "node:fs/promises";
import {createHash} from "node:crypto";
import {magic, maximumFile, maximumIndex, requireFormat, uint64, chunk, adler32, resourceBytes, sourceHash} from "./bytes.mjs";
import {readXp3} from "./xp3.mjs";
import {resolveSeedOnly} from "./resource-format.mjs";

async function writeAll(handle, bytes) {
  for (let at = 0; at < bytes.length;) {
    const {bytesWritten} = await handle.write(bytes, at, bytes.length - at);
    requireFormat(bytesWritten > 0); at += bytesWritten;
  }
}
function record(entry, offset, size, checksum) {
  const name = Buffer.from(entry.name, "utf16le"), info = Buffer.alloc(22), segment = Buffer.alloc(28), adler = Buffer.alloc(4);
  info.writeBigUInt64LE(BigInt(size), 4); info.writeBigUInt64LE(BigInt(size), 12); info.writeUInt16LE(name.length / 2, 20);
  segment.writeBigUInt64LE(BigInt(offset), 4); segment.writeBigUInt64LE(BigInt(size), 12); segment.writeBigUInt64LE(BigInt(size), 20); adler.writeUInt32LE(checksum);
  return chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, name])), chunk("segm", segment), chunk("adlr", adler),
    ...(entry.time ? [chunk("time", entry.time)] : [])]));
}
async function transformed(archive, entry, filter, target, signal) {
  if (archive.format === "xp3-native" && entry.seedOnly) {
    requireFormat(filter.verified && entry.flags === 0 && entry.adler === 0 && entry.readable <= 32 * 1024 * 1024, "CHECKSUM_MISMATCH");
    const chunks = [];
    for await (const bytes of resourceBytes(archive.locator, entry, signal)) {chunks.push(bytes);}
    const raw = Buffer.concat(chunks), output = resolveSeedOnly(raw, filter, entry.h);
    await writeAll(target, output);
    return {size: output.length, checksum: adler32(output), sha256: createHash("sha256").update(output).digest("hex"),
      rawSha256: createHash("sha256").update(raw).digest("hex"), corrections: ["REUSED_FILTER_SEED"]};
  }
  const rawHash = createHash("sha256"), decodedHash = createHash("sha256");
  let size = 0, checksum = 1, prefix = Buffer.alloc(0);
  for await (const bytes of resourceBytes(archive.locator, entry, signal)) {
    if (prefix.length < 64) {prefix = Buffer.concat([prefix, bytes.subarray(0, 64 - prefix.length)]);}
    rawHash.update(bytes); filter.apply(bytes, entry.h, size, entry);
    checksum = adler32(bytes, checksum); decodedHash.update(bytes); size += bytes.length;
    requireFormat(size <= entry.readable);
    await writeAll(target, bytes);
  }
  requireFormat(size === entry.readable);
  const corrections = [];
  if (size !== entry.size || entry.segments.reduce((sum, segment) => sum + segment.packed, 0) !== entry.packed) {
    // This protector's warning sentinel is metadata, not a truncated script or
    // image. Both its table name and raw body identify it independently of h.
    requireFormat(filter.verified && entry.flags === 0 && size < entry.size && entry.size <= 4096 &&
      entry.name.startsWith("$$$ this is a protected archive. $$$") && entry.name.endsWith(".txt") &&
      entry.segments.every(segment => segment.mode === 0) && prefix.toString("ascii").startsWith("Warning: Extracting this archive"));
    corrections.push("FORMAT_WARNING_SHORT_STREAM");
  }
  if (checksum !== entry.adler && !corrections.length) {
    // Modified CxFilterFS tables can reuse h as a filter seed for different
    // contents. The native reader does not validate it as a decoded checksum.
    // Require the repeated seed structure and an independently validated filter.
    requireFormat(filter.kind === "tiny" && entry.seedOnly && filter.verified, "CHECKSUM_MISMATCH");
    corrections.push("REUSED_FILTER_SEED");
  }
  return {size, checksum, sha256: decodedHash.digest("hex"), rawSha256: rawHash.digest("hex"), corrections};
}
async function verify(path, entries, signal) {
  const handle = await open(path, "r"); let sizeBytes;
  try {sizeBytes = (await handle.stat()).size;} finally {await handle.close();}
  const locator = {path, offset: 0, sizeBytes}, archive = await readXp3(locator, {signal, includePlainEntries: true});
  requireFormat(archive?.format === null && archive.entries.length === entries.length, "OUTPUT_MISMATCH");
  for (let i = 0; i < entries.length; i++) {
    const expected = entries[i], entry = archive.entries[i], digest = createHash("sha256");
    requireFormat(entry.name === expected.name && entry.size === expected.size && entry.adler === expected.checksum && entry.flags === 0, "OUTPUT_MISMATCH");
    let count = 0, checksum = 1;
    for await (const bytes of resourceBytes(locator, entry, signal)) {count += bytes.length; checksum = adler32(bytes, checksum); digest.update(bytes);}
    requireFormat(count === expected.size && checksum === expected.checksum && digest.digest("hex") === expected.sha256, "OUTPUT_MISMATCH");
  }
  return {sizeBytes, sha256: await sourceHash(locator, signal)};
}
/** Stream one protected logical namespace to an ordinary, independently reread XP3. */
export async function convertXp3(archive, file, path, filter, audit, signal) {
  requireFormat(await sourceHash(archive.sourceLocator ?? archive.locator, signal) === file.sha256, "SOURCE_CHANGED");
  const target = await open(path, "wx", 0o600), records = [], expected = [];
  let position = 19, indexSize = 0, verifiedEntries = 0, metadataCorrections = 0;
  try {
    await writeAll(target, Buffer.concat([magic, Buffer.alloc(8)]));
    for (const entry of archive.entries) {
      signal?.throwIfAborted();
      requireFormat(position + entry.readable <= maximumFile, "ARCHIVE_LIMIT");
      const result = await transformed(archive, entry, filter, target, signal), item = record(entry, position, result.size, result.checksum);
      records.push(item); indexSize += item.length; requireFormat(indexSize <= maximumIndex, "ARCHIVE_LIMIT");
      expected.push({name: entry.name, ...result}); position += result.size;
      if (result.corrections.length) {metadataCorrections++;} else {verifiedEntries++;}
      await audit({archive: file.logicalKey, kind: "resource", logicalName: entry.name, physicalName: entry.physical,
        sourceSize: entry.size, sourcePackedSize: entry.packed, sourceAdler32: entry.adler, sourceSeed: entry.h, sourceFlags: entry.flags,
        outputSize: result.size, outputAdler32: result.checksum, outputSha256: result.sha256, rawStreamSha256: result.rawSha256,
        sourceIntegrityVerified: result.corrections.length === 0, corrections: result.corrections});
    }
    requireFormat(position + 9 + indexSize <= maximumFile, "ARCHIVE_LIMIT");
    await writeAll(target, Buffer.concat([Buffer.from([0]), uint64(indexSize)]));
    for (const bytes of records) {await writeAll(target, bytes);}
    const {bytesWritten} = await target.write(uint64(position), 0, 8, 11); requireFormat(bytesWritten === 8);
    await target.sync();
  } finally {await target.close();}
  for (const entry of archive.omitted) {
    const digest = createHash("sha256"); let count = 0;
    for await (const bytes of resourceBytes(archive.locator, entry, signal)) {count += bytes.length; digest.update(bytes);}
    await audit({archive: file.logicalKey, kind: "physical-only", physicalName: entry.physical, sourceSize: entry.size, readableSize: count,
      sourceFlags: entry.flags, sourceAdler32: entry.adler, rawStreamSha256: digest.digest("hex"), reason: "OUTSIDE_LOGICAL_NAMESPACE"});
  }
  const result = await verify(path, expected, signal);
  requireFormat(await sourceHash(archive.sourceLocator ?? archive.locator, signal) === file.sha256, "SOURCE_CHANGED");
  return {...file, ...result, path, verifiedEntries, metadataCorrections, omittedPhysicalEntries: archive.omitted.length};
}
