import {safePath} from "../runtime-archive-input.mjs";
import {enigmaLimits, enigmaNumber, enigmaCrypt, enigmaDepack, enigmaRange, requireEnigma, readEnigma} from "./enigma-codec.mjs";

function cstring(bytes, start) {
  let at = start;
  while (at + 2 <= bytes.length && bytes.readUInt16LE(at) !== 0) {at += 2; requireEnigma(at - start <= 8192, "LIMIT");}
  requireEnigma(at + 2 <= bytes.length);
  let text;
  try {text = new TextDecoder("utf-16le", {fatal: true, ignoreBOM: true}).decode(bytes.subarray(start, at));}
  catch {throw new Error("RUNTIME_ENIGMA_INVALID");}
  return {text, end: at + 2};
}
function fileRecord(bytes, at) {
  enigmaRange(bytes, at, 38);
  const registrationFlags = bytes[at], action = bytes[at + 1], sizeBytes = enigmaNumber(bytes, at + 2);
  const flags = bytes[at + 38], target = cstring(bytes, at + 39), stored = enigmaNumber(bytes, target.end);
  requireEnigma(registrationFlags === 0 && action === 0 && flags === 0 && target.text === "", "UNSUPPORTED");
  requireEnigma(sizeBytes <= enigmaLimits.file && stored <= enigmaLimits.file, "LIMIT");
  requireEnigma(target.end + 8 === bytes.length);
  return {sizeBytes, stored};
}

/** Read the whole bounded directory, preserving exact names and native preorder.
 * A file body follows its record and is skipped before reading child records.
 */
export async function enigmaVFS(handle, sourceSize, profile, signal) {
  const {base, packageSize, headerState, payloadState, compressed} = profile;
  const firstBytes = await readEnigma(handle, sourceSize, base, 56, signal);
  const first = profile.encryptedHeader === false ? firstBytes : enigmaCrypt(firstBytes, headerState);
  // Header 1 begins with a counted signature, not a format version.
  requireEnigma(first.readUInt32LE() > 0 && first.readUInt32LE() <= 44, "UNSUPPORTED");
  requireEnigma(enigmaNumber(first, 48) + 56 === packageSize);
  const header = enigmaCrypt(await readEnigma(handle, sourceSize, base + 56, 64, signal), headerState);
  requireEnigma(header.readUInt32LE() === 0 && header.readUInt32LE(4) === 64 && enigmaNumber(header, 24) === 120 &&
    enigmaNumber(header, 32) + 120 === packageSize && enigmaNumber(header, 48) === packageSize);
  const timestamp = header.readDoubleLE(8); requireEnigma(Number.isFinite(timestamp), "UNSUPPORTED");
  const rows = [], seen = new Set(), stack = [{count: 1, path: "", root: true}];
  let at = base + 120, metadata = 120, count = 0, total = 0;
  while (stack.length) {
    signal?.throwIfAborted(); const parent = stack.at(-1);
    if (!parent.count) {stack.pop(); continue;}
    parent.count--; requireEnigma(++count <= enigmaLimits.entries && stack.length <= 128, "LIMIT");
    const length = enigmaCrypt(await readEnigma(handle, base + packageSize, at, 4, signal), headerState).readUInt32LE(); at += 4;
    requireEnigma(length >= 15 && (metadata += 4 + length) <= enigmaLimits.metadata, "LIMIT");
    const record = enigmaCrypt(await readEnigma(handle, base + packageSize, at, length, signal), headerState); at += length;
    const children = record.readUInt32LE(8), name = cstring(record, 12), kind = record[name.end], tail = name.end + 1;
    requireEnigma(children <= enigmaLimits.entries && tail <= record.length, "LIMIT");
    let path;
    if (parent.root) {requireEnigma(kind === 0 && name.text === "" && children > 0 && tail === record.length, "UNSUPPORTED"); path = "";}
    else if (stack.length === 2) {requireEnigma(kind === 3 && name.text === "%DEFAULT FOLDER%", "UNSUPPORTED"); path = "";}
    else {
      requireEnigma(!/[\\/%]/u.test(name.text) && safePath(name.text), "PATH_INVALID");
      path = parent.path ? parent.path + "/" + name.text : name.text;
      requireEnigma(safePath(path), "PATH_INVALID");
    }
    if (kind === 2) {
      requireEnigma(children === 0 && path, "UNSUPPORTED");
      const file = fileRecord(record, tail);
      requireEnigma(file.stored <= base + packageSize - at && (total += file.sizeBytes) <= enigmaLimits.tree, "LIMIT");
      requireEnigma(compressed || file.sizeBytes === file.stored);
      const key = path.toUpperCase();
      if (!seen.has(key)) {rows.push({...file, name: path, offset: at, payloadState, compressed}); seen.add(key);}
      at += file.stored;
    } else if (kind === 3) {requireEnigma(tail + 29 === record.length, "UNSUPPORTED");}
    else {requireEnigma(kind === 0 && parent.root, "UNSUPPORTED");}
    if (children) {stack.push({count: children, path, root: false});}
  }
  requireEnigma(at === base + packageSize && rows.length > 0);
  return {rows, timestamp, metadataBytes: metadata};
}

export async function* enigmaResource(handle, sourceSize, row, signal) {
  if (!row.compressed) {
    for (let at = 0; at < row.sizeBytes; at += 8192) {
      yield enigmaCrypt(await readEnigma(handle, sourceSize, row.offset + at, Math.min(8192, row.sizeBytes - at), signal), row.payloadState);
    }
    return;
  }
  const count = Math.ceil(row.sizeBytes / 65536); let previous = count * 12;
  requireEnigma(previous <= row.stored && previous <= enigmaLimits.metadata, "LIMIT");
  for (let i = 0; i < count; i++) {
    const record = enigmaCrypt(await readEnigma(handle, sourceSize, row.offset + i * 12, 12, signal), row.payloadState);
    const offset = enigmaNumber(record, 0), size = record.readUInt32LE(8), expanded = Math.min(65536, row.sizeBytes - i * 65536);
    requireEnigma(offset === previous && size > 0 && size <= 128 * 1024 && size <= row.stored - offset);
    const packed = enigmaCrypt(await readEnigma(handle, sourceSize, row.offset + offset, size, signal), row.payloadState);
    yield enigmaDepack(packed, expanded, signal); previous = offset + size;
  }
  requireEnigma(previous === row.stored);
}
