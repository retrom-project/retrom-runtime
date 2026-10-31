import {createHash} from "node:crypto";
import {openContent} from "../runtime-host-content.mjs";
import {magic, maximumIndex, maximumFile, requireFormat, number64, chunks, readExact, inflate, text16, normalizeName, safeName} from "./bytes.mjs";
import {shortWarningShape, validateWarningMetadata} from "./warning-metadata.mjs";

export async function indexes(handle, signal, onTag) {
  requireFormat((await readExact(handle, 0, magic.length)).equals(magic));
  let position = number64(await readExact(handle, 11, 8)), total = 0;
  const visited = new Set(), result = [];
  for (let depth = 0; depth < 16; depth++) {
    signal?.throwIfAborted(); requireFormat(position >= 19 && !visited.has(position)); visited.add(position);
    const flag = (await readExact(handle, position, 1))[0]; position++;
    requireFormat((flag & ~0x81) === 0, "ARCHIVE_UNSUPPORTED");
    const compressed = (flag & 1) !== 0, header = await readExact(handle, position, compressed ? 16 : 8);
    position += header.length;
    const packed = number64(header), expanded = compressed ? number64(header, 8) : packed;
    requireFormat(packed <= maximumIndex && expanded <= maximumIndex - total, "ARCHIVE_LIMIT"); total += expanded;
    const data = await readExact(handle, position, packed); position += packed;
    for (const row of chunks(compressed ? inflate(data, expanded) : data, onTag)) {result.push(row);}
    if (!(flag & 0x80)) {return result;}
    position = number64(await readExact(handle, position, 8));
  }
  throw new Error("RUNTIME_KIRIKIRI_ARCHIVE_LIMIT");
}
export function parseFile(data, sourceSize, canonicalizeInfoSize) {
  const fields = new Map(); let infoSizeCorrection;
  for (let at = 0; at < data.length;) {
    requireFormat(at + 12 <= data.length);
    const tag = data.toString("ascii", at, at + 4), declared = number64(data, at + 4), start = at + 12;
    let length = declared;
    if (canonicalizeInfoSize && tag === "info" && declared > data.length - start && declared <= 22 + 32767 * 2 + 2) {
      // Only a terminal info record can borrow its enclosing File boundary.
      // text16 below must consume an exact counted name (plus optional NUL),
      // and conversion must authenticate the complete resource checksum.
      requireFormat(fields.has("segm") && fields.has("adlr"));
      length = data.length - start; infoSizeCorrection = {declared, actual: length};
    }
    requireFormat(length <= data.length - start);
    requireFormat(["info", "segm", "adlr", "time"].includes(tag) && !fields.has(tag), "ARCHIVE_UNSUPPORTED");
    fields.set(tag, data.subarray(start, start + length)); at = start + length;
  }
  const info = fields.get("info"), segm = fields.get("segm"), checksum = fields.get("adlr"), time = fields.get("time");
  requireFormat(info?.length >= 22 && segm?.length > 0 && segm.length % 28 === 0 && checksum?.length === 4 && (!time || time.length === 8));
  const physical = text16(info, 22, info.readUInt16LE(20)), size = number64(info, 4), packed = number64(info, 12), flags = info.readUInt32LE();
  requireFormat((flags === 0 || flags === 0x80000000) && size <= maximumFile && packed <= maximumFile, "ARCHIVE_UNSUPPORTED");
  const segments = [];
  let readable = 0, stored = 0;
  for (let at = 0; at < segm.length; at += 28) {
    const mode = segm.readUInt32LE(at), offset = number64(segm, at + 4), expanded = number64(segm, at + 12), count = number64(segm, at + 20);
    requireFormat((mode === 0 || mode === 1) && (mode || expanded === count) && offset >= 19 && offset <= sourceSize && count <= sourceSize - offset);
    readable += expanded; stored += count;
    requireFormat(readable <= maximumFile && stored <= maximumFile, "ARCHIVE_LIMIT");
    segments.push({mode, offset, expanded, packed: count});
  }
  const entry = {physical, name: physical, size, packed, flags, segments, readable, adler: checksum.readUInt32LE(), time,
    ...(infoSizeCorrection ? {infoSizeCorrection} : {})};
  requireFormat(stored <= packed && readable <= size && (stored === packed && readable === size || shortWarningShape(entry)));
  return entry;
}
function parseNames(rows) {
  const names = new Map();
  for (const {tag, bytes} of rows) {
    requireFormat(["eliF", "hnfn", "Yuzu", "neko"].includes(tag) && bytes.length >= 6);
    const name = normalizeName(text16(bytes, 6, bytes.readUInt16LE(4)));
    requireFormat(safeName(name) && !names.has(name));
    names.set(name, bytes.readUInt32LE());
  }
  return names;
}
async function nameTable(rows, handle) {
  const descriptors = rows.filter(row => row.tag === "sen:");
  if (!descriptors.length) {
    const direct = rows.filter(row => ["eliF", "hnfn", "Yuzu", "neko"].includes(row.tag));
    requireFormat(new Set(direct.map(row => row.tag)).size === 1);
    return {format: `cxfilterfs-${direct[0].tag.toLowerCase()}`, names: parseNames(direct), salt: ""};
  }
  requireFormat(descriptors.length === 1 && rows.every(row => row.tag === "sen:" || row.tag === "File"));
  const data = descriptors[0].bytes; requireFormat(data.length >= 18);
  const offset = number64(data), expanded = data.readUInt32LE(8), packed = data.readUInt32LE(12), salt = text16(data, 18, data.readUInt16LE(16), {empty: true});
  requireFormat(expanded <= maximumIndex && packed <= maximumIndex && offset >= 19);
  const table = [...chunks(inflate(await readExact(handle, offset, packed), expanded))];
  requireFormat(table.length > 0 && table.every(row => row.tag === "hnfn"));
  return {format: "cxfilterfs-sen", names: parseNames(table), salt};
}
function linkEntries(files, table) {
  requireFormat(files.length <= 250000 && table.names.size > 0 && table.names.size <= files.length, "ARCHIVE_LIMIT");
  const physical = new Map(), entries = [], linked = new Set(), seeds = new Map();
  for (const file of files) {requireFormat(!physical.has(file.physical)); physical.set(file.physical, file);}
  for (const [name, h] of table.names) {
    const digest = createHash("md5").update(name + table.salt, "utf16le").digest("hex"), entry = physical.get(digest);
    requireFormat(entry && !linked.has(digest), "NAME_MAP_INVALID");
    requireFormat(entry.adler === h, "NAME_MAP_INVALID");
    requireFormat(!/(?:^|\/)xp3filter\.tjs$/iu.test(name), "ARCHIVE_UNSUPPORTED");
    linked.add(digest); seeds.set(h, (seeds.get(h) ?? 0) + 1); entries.push({...entry, name, h});
  }
  // The CxFilterFS namespace exposes only table names. Literal physical decoys are
  // outside that namespace; an unlinked hashed entry instead means an incomplete table.
  const omitted = files.filter(file => !linked.has(file.physical));
  requireFormat(omitted.every(file => !/^[a-f\d]{32}$/iu.test(file.physical)), "NAME_MAP_INVALID");
  const seedOnly = seeds.size === 1 && entries.length > 1 && entries.every(entry => entry.flags === 0x80000000 && entry.readable === entry.size);
  for (const entry of entries) {entry.reusedSeed = seeds.get(entry.h) > 1; entry.seedOnly = seedOnly;}
  return {entries, omitted};
}
/** Inspect immutable logical slices, including non-.xp3 names, without executing native code. */
export async function readXp3(locator, {signal, includePlainEntries = false, canonicalizeInfoSize = false} = {}) {
  if (locator.sizeBytes < magic.length) {return null;}
  const handle = await openContent(locator);
  try {
    if (!(await readExact(handle, 0, magic.length)).equals(magic)) {return null;}
    let rows, matched = false;
    try {rows = await indexes(handle, signal, tag => {matched ||= ["eliF", "hnfn", "Yuzu", "neko", "sen:"].includes(tag);});}
    catch (error) {
      // An XP3 signature alone does not identify CxFilterFS. An index encoding
      // we cannot inspect is unmatched; ordinary import owns its validation.
      // Output verification remains strict, and errors after a known name-table
      // tag has been identified below are never turned into an unmatched result.
      if (!matched && !includePlainEntries && !signal?.aborted && /^RUNTIME_KIRIKIRI_ARCHIVE_(?:INVALID|UNSUPPORTED|LIMIT)$/u.test(error.message ?? "")) {
        return {locator, format: null};
      }
      throw error;
    }
    const tags = new Set(rows.map(row => row.tag));
    // No registered converter can recover this namespace. Keep the archive for
    // ordinary configuration/validation rather than claiming a failed conversion.
    const protectedNames = ["eliF", "hnfn", "Yuzu", "neko", "sen:"].some(tag => tags.has(tag));
    if (tags.has("Hxv4") && !protectedNames) {return {locator, format: null, unsupportedFormat: "hxv4"};}
    if (!protectedNames && !includePlainEntries) {return {locator, format: null};}
    if (protectedNames) {requireFormat(rows.every(row => ["File", "eliF", "hnfn", "Yuzu", "neko", "sen:"].includes(row.tag)), "ARCHIVE_UNSUPPORTED");}
    const files = rows.filter(row => row.tag === "File").map(row => parseFile(row.bytes, locator.sizeBytes, canonicalizeInfoSize));
    if (!protectedNames) {
      await validateWarningMetadata(locator, files, signal);
      return {locator, format: null, entries: files};
    }
    const table = await nameTable(rows, handle);
    const linked = linkEntries(files, table); await validateWarningMetadata(locator, linked.entries, signal);
    return {locator, ...table, ...linked};
  } catch (error) {
    if (signal?.aborted || error.message?.startsWith("RUNTIME_")) {throw error;}
    throw new Error("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");
  } finally {await handle.close();}
}
