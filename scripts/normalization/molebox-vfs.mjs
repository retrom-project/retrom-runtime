import {createHash} from "node:crypto";
import {crc32} from "node:zlib";
import {safePath} from "../runtime-archive-input.mjs";
import {moleboxLimits, requireMolebox, moleboxRange, readMoleboxAt, moleboxKey, decodeMolebox} from "./molebox-codec.mjs";
import {readMoleboxLoader} from "./molebox-pe.mjs";

const folded = name => name.toUpperCase();
function stringAt(bytes, offset) {
  requireMolebox(offset > 0 && offset < bytes.length);
  const end = bytes.indexOf(0, offset);
  requireMolebox(end >= offset && end - offset <= 4096);
  try {return new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(offset, end));}
  catch {throw new Error("RUNTIME_MOLEBOX_INVALID");}
}
function nodeName(metadata, offset, count, root) {
  if (root) {requireMolebox(offset === 0 && count === 0); return "";}
  requireMolebox(offset > 0 && count > 0 && count <= 2048, "RUNTIME_MOLEBOX_UNSUPPORTED");
  let name;
  try {name = new TextDecoder("utf-16le", {fatal: true}).decode(moleboxRange(metadata, offset, count * 2));}
  catch {throw new Error("RUNTIME_MOLEBOX_PATH_INVALID");}
  requireMolebox(!/[\\/:*?"<>|]/u.test(name) && !/[. ]$/u.test(name) && safePath(name),
    "RUNTIME_MOLEBOX_PATH_INVALID");
  return name;
}
function blocksAt(metadata, offset, count, fileSize, base, dataEnd, spans, budget) {
  requireMolebox(count === Math.ceil(fileSize / moleboxLimits.block));
  requireMolebox(count <= 1000000 - budget.blocks, "RUNTIME_MOLEBOX_LIMIT"); budget.blocks += count;
  moleboxRange(metadata, offset, count * 12);
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const at = offset + i * 12, packed = metadata.readUInt16LE(at), sizeBytes = metadata.readUInt16LE(at + 2),
      flags = metadata.readUInt16LE(at + 4), crc16 = metadata.readUInt16LE(at + 6), position = base + metadata.readUInt32LE(at + 8);
    requireMolebox((flags & ~6) === 0, "RUNTIME_MOLEBOX_UNSUPPORTED");
    requireMolebox(packed > 0 && sizeBytes === Math.min(fileSize - i * moleboxLimits.block, moleboxLimits.block) &&
      position >= base && position <= dataEnd && packed <= dataEnd - position && (!(flags & 4) || packed % 8 === 0) &&
      (flags & 2 || (flags & 4 ? packed === Math.ceil(sizeBytes / 8) * 8 : packed === sizeBytes)));
    blocks.push({offset: position, packed, sizeBytes, flags, crc16}); spans.push({start: position, end: position + packed});
  }
  return blocks;
}
function treeRows(metadata, rootOffset, listOffset, count, base, dataEnd, key, table, budget, packageIndex) {
  requireMolebox(count > 0 && count <= moleboxLimits.entries, "RUNTIME_MOLEBOX_LIMIT");
  const listed = moleboxRange(metadata, listOffset, count * 4), expected = new Set();
  for (let i = 0; i < count; i++) {expected.add(listed.readUInt32LE(i * 4));}
  requireMolebox(expected.size === count);
  const visited = new Set(), paths = new Set(), rows = [], spans = [];
  function walk(offset, parent, depth, root = false) {
    requireMolebox(depth <= 32 && visited.size < moleboxLimits.entries + 1, "RUNTIME_MOLEBOX_LIMIT");
    requireMolebox(!visited.has(offset)); visited.add(offset);
    const node = moleboxRange(metadata, offset, 52), flags = node.readUInt32LE(40), directory = (flags & 0x80000000) !== 0;
    requireMolebox(node.readUInt32LE() === 0 && node.readUInt32LE(4) === 0 && node.readUInt32LE(36) === 0);
    requireMolebox(directory ? flags === 0x80000000 : (flags & ~6) === 0, "RUNTIME_MOLEBOX_UNSUPPORTED");
    // Hidden names and conditional physical-file fallback change native lookup
    // or enumeration. They cannot be restored as unconditional loose files.
    const name = nodeName(metadata, node.readUInt32LE(8), node.readUInt32LE(12), root), path = root ? "" : parent + name;
    if (!root) {
      requireMolebox(safePath(path), "RUNTIME_MOLEBOX_PATH_INVALID");
      requireMolebox(expected.has(offset) && !paths.has(folded(path))); paths.add(folded(path));
    } else {requireMolebox(directory);}
    const length = node.readUInt32LE(44), children = node.readUInt32LE(48);
    if (directory) {
      requireMolebox(length === 0 && children <= moleboxLimits.entries, "RUNTIME_MOLEBOX_LIMIT");
      const pointers = moleboxRange(metadata, offset + 52, children * 4);
      for (let i = 0; i < children; i++) {walk(pointers.readUInt32LE(i * 4), path ? path + "/" : "", depth + 1);}
    } else {
      requireMolebox(length <= moleboxLimits.file && budget.tree + length <= moleboxLimits.tree, "RUNTIME_MOLEBOX_LIMIT");
      budget.tree += length;
      rows.push({name: path, sizeBytes: length, flags, key, table, packageIndex,
        blocks: blocksAt(metadata, offset + 52, children, length, base, dataEnd, spans, budget)});
    }
  }
  walk(rootOffset, "", 0, true);
  requireMolebox(visited.size === expected.size + 1 && [...expected].every(offset => visited.has(offset)));
  spans.sort((a, b) => a.start - b.start);
  requireMolebox(spans.every((span, i) => i === 0 || span.start >= spans[i - 1].end));
  return rows;
}
async function packageRows(handle, sourceSize, footerOffset, seed, loader, budget, signal, packageIndex) {
  const key = moleboxKey(seed), encoded = await readMoleboxAt(handle, sourceSize, footerOffset, 48, signal),
    header = decodeMolebox(encoded, key, loader.table);
  const repeated = Uint8Array.from({length: 60}, (_, i) => seed[i % 15]), marker = decodeMolebox(
    decodeMolebox(Buffer.from("STELPACK"), repeated, loader.table, false), repeated, loader.table, false);
  requireMolebox(header.subarray(40, 48).equals(marker), "RUNTIME_MOLEBOX_UNSUPPORTED");
  const metadataOffset = header.readUInt32LE(), length = header.readUInt32LE(4), base = footerOffset - header.readUInt32LE(12);
  requireMolebox(length > 0 && length <= moleboxLimits.metadata && budget.metadata + length <= moleboxLimits.image, "RUNTIME_MOLEBOX_LIMIT");
  requireMolebox(base >= loader.dataStart && metadataOffset >= base && metadataOffset === footerOffset - length && length % 8 === 0);
  requireMolebox(!header.readUInt32LE(32) && !header.readUInt32LE(36), "RUNTIME_MOLEBOX_INJECTION_UNSUPPORTED");
  const bytes = await readMoleboxAt(handle, sourceSize, metadataOffset, length, signal), metadata = decodeMolebox(bytes, key, loader.table);
  requireMolebox(crc32(metadata) === header.readUInt32LE(16)); budget.metadata += length;
  return treeRows(metadata, header.readUInt32LE(8), header.readUInt32LE(20), header.readUInt32LE(24),
    base, metadataOffset, key, loader.table, budget, packageIndex);
}

/** Inspect one immutable PE slice; named VFS files retain the native mount order.
 * This exposes resources only. Additional DLL/registry injection, external mounts,
 * hidden nodes and physical-file fallback need separate evidence-backed support.
 */
export async function inspectMolebox(handle, sourceSize, signal) {
  const loader = await readMoleboxLoader(handle, sourceSize, signal);
  if (!loader) {return null;}
  const {catalogOffset, password, table} = loader;
  requireMolebox(catalogOffset >= loader.dataStart + 8);
  const key = moleboxKey(createHash("md5").update(password).digest()),
    footer = decodeMolebox(await readMoleboxAt(handle, sourceSize, catalogOffset, 8, signal), key, table, false),
    length = footer.readUInt32LE();
  requireMolebox(length > 0 && length <= 65536 && length % 8 === 0, "RUNTIME_MOLEBOX_LIMIT");
  requireMolebox(catalogOffset - length >= loader.dataStart);
  const encoded = await readMoleboxAt(handle, sourceSize, catalogOffset - length, length, signal), catalog = decodeMolebox(encoded, key, table);
  requireMolebox(crc32(catalog) === footer.readUInt32LE(4) && length >= 16);
  const list = catalog.readUInt32LE(), count = catalog.readUInt32LE(4), mounts = catalog.readUInt32LE(8), mountCount = catalog.readUInt32LE(12);
  requireMolebox(count > 0 && count <= moleboxLimits.packages && mountCount === count, "RUNTIME_MOLEBOX_UNSUPPORTED");
  moleboxRange(catalog, list, count * 8); moleboxRange(catalog, mounts, count * 24);
  const selected = new Map(), budget = {metadata: length, tree: 0, blocks: 0};
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    const mount = mounts + i * 24, entry = list + i * 8;
    // Native mount records use their ordinal to select the embedded package;
    // the name is descriptive, not a password lookup or a file selector.
    requireMolebox(catalog.readUInt32LE(mount) === 1, "RUNTIME_MOLEBOX_UNSUPPORTED");
    stringAt(catalog, catalog.readUInt32LE(mount + 4)); stringAt(catalog, catalog.readUInt32LE(entry + 4));
    const position = catalog.readUInt32LE(entry);
    requireMolebox(position + 48 <= catalogOffset - length);
    const rows = await packageRows(handle, sourceSize, position, catalog.subarray(mount + 8, mount + 24), loader, budget, signal, i);
    for (const row of rows) {selected.set(folded(row.name), row);}
  }
  requireMolebox(selected.size > 0 && selected.size <= moleboxLimits.entries, "RUNTIME_MOLEBOX_LIMIT");
  return {rows: [...selected.values()].sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))),
    evidence: {...loader.evidence, packageCount: count, metadataBytes: budget.metadata, verifiedMetadataCRC32: count + 1,
      sourceBlocks: budget.blocks}};
}

