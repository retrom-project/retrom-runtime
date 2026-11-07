import {openContent} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {enigmaLayout} from "./enigma-pe.mjs";
import {enigmaLimits, enigmaNumber, enigmaRange, readEnigma, requireEnigma} from "./enigma-codec.mjs";
import {enigmaConvertPlan, enigmaVirtualRows} from "./enigma-plan.mjs";

const match = (b, at, pattern) => at >= 0 && at + pattern.length <= b.length && pattern.every((v, i) => v === null || b[at + i] === v);
const find = (b, pattern) => {for (let at = 0; at + pattern.length <= b.length; at++) {if (match(b, at, pattern)) {return at;}} return -1;};
const defaultFolder = "%DEFAULT FOLDER%";
// Loader reads: section[count - 2].VirtualAddress/PointerToRawData + config[168],
// then prefix length +156, prefix +176 and the external package count +164.
const configSection = [0x0f, 0xb7, 0x40, 6, 0x8d, 4, 0x80, 0x8b, 0x55, null, 0x8b, 0x94, 0xc2, 0xb4, 0, 0, 0];
const packageOffset = [0x8b, 0x84, 0xc2, 0xbc, 0, 0, 0, 0x8b, 0x55, null, 3, 0x82, 0xa8, 0, 0, 0];
const prefixLength = [0x8b, 0x80, 0x9c, 0, 0, 0, 0x8b, 0x16, 0x89, 0x42, 0x70];
const prefixStart = [5, 0xb0, 0, 0, 0];
const packageCount = [0x8b, 0x80, 0xa4, 0, 0, 0, 0x50];
const evbMagic = Buffer.from("EVB\0", "latin1");

function wide(bytes, at, units) {
  const raw = enigmaRange(bytes, at, units * 2);
  try {return new TextDecoder("utf-16le", {fatal: true, ignoreBOM: true}).decode(raw);} catch {return requireEnigma(false);}
}
function cstring(bytes, start) {
  let at = start;
  while (enigmaRange(bytes, at, 2).readUInt16LE() !== 0) {at += 2; requireEnigma(at - start <= 8192, "LIMIT");}
  return {text: wide(bytes, start, (at - start) / 2), end: at + 2};
}

/** Recognize the connected TLS loader and its section-relative package configuration. */
export async function virtualBoxPE(handle, size, signal) {
  const pe = await enigmaLayout(handle, size, signal), tls = pe?.directory(9);
  if (!pe || !tls?.rva || pe.sections.length < 3) {return null;}
  const tlsAt = pe.fromRva(tls.rva, 24);
  if (tlsAt < 0) {return null;}
  const callbacksVa = (await readEnigma(handle, size, tlsAt + 12, 4, signal)).readUInt32LE();
  const callbacksAt = callbacksVa > pe.imageBase ? pe.fromRva(callbacksVa - pe.imageBase, 4) : -1;
  if (callbacksAt < 0) {return null;}
  const callbackVa = (await readEnigma(handle, size, callbacksAt, 4, signal)).readUInt32LE();
  const callbackAt = callbackVa > pe.imageBase ? pe.fromRva(callbackVa - pe.imageBase, 128) : -1;
  if (callbackAt < 0) {return null;}
  const callback = await readEnigma(handle, size, callbackAt, 128, signal);
  // The callback passes (0, 0) to the loader initializer; choose the nearest such
  // call target whose code contains every connected configuration read.
  let initRva = -1;
  for (let call = 0; call + 9 <= callback.length; call++) {
    if (!match(callback, call, [0x33, 0xd2, 0x33, 0xc0, 0xe8])) {continue;}
    const target = callbackVa - pe.imageBase + call + 9 + callback.readInt32LE(call + 5), targetAt = pe.fromRva(target, 4096);
    if (targetAt < 0) {continue;}
    const init = await readEnigma(handle, size, targetAt, 4096, signal), select = find(init, configSection);
    if (select >= 0 && match(init, select + 17, [0x8b, 0x0d]) && find(init.subarray(select), packageOffset) >= 0 &&
        find(init, prefixLength) >= 0 && find(init, prefixStart) >= 0 && find(init, packageCount) >= 0 && target > initRva) {initRva = target;}
  }
  if (initRva < 0) {return null;}
  const section = pe.sections.at(-2);
  requireEnigma(section.length >= 176, "UNSUPPORTED");
  const config = await readEnigma(handle, size, section.raw, Math.min(section.length, 64 * 1024), signal);
  const prefixUnits = config.readUInt32LE(156), count = config.readUInt32LE(164);
  requireEnigma(wide(config, 176, prefixUnits) === defaultFolder + "\\" && count <= 64, "UNSUPPORTED");
  let at = 176 + prefixUnits * 2; const masks = [];
  for (let i = 0; i < count; i++) {
    const units = enigmaRange(config, at, 2).readUInt16LE(), mask = wide(config, at + 2, units); at += 2 + units * 2;
    requireEnigma(units > 0 && !/[\\/:%]/u.test(mask) && [...mask].every(c => c.charCodeAt(0) >= 32), "PATH_INVALID");
    masks.push(mask);
  }
  const internalOffset = config.readUInt32LE(168), internalSize = config.readUInt32LE(112);
  requireEnigma(internalOffset >= at && internalSize >= 64 && internalSize <= section.length - internalOffset, "UNSUPPORTED");
  return {masks, internal: {base: section.raw + internalOffset, size: internalSize},
    evidence: {tlsCallbackRva: callbackVa - pe.imageBase, loaderRva: initRva, configSection: pe.sections.length - 2, masks: masks.length}};
}

async function header(handle, sourceSize, base, size, signal) {
  if (size < 64) {return null;}
  const bytes = await readEnigma(handle, sourceSize, base, 64, signal);
  if (!bytes.subarray(0, 4).equals(evbMagic)) {return null;}
  requireEnigma(bytes.readUInt32LE(4) === 64, "UNSUPPORTED");
  const timestamp = bytes.readDoubleLE(8), files = bytes.readUInt32LE(16), layout = bytes.readUInt32LE(20);
  const fsOffset = enigmaNumber(bytes, 24), fsSpan = enigmaNumber(bytes, 32);
  const registry = bytes.readUInt32LE(40), registryOffset = enigmaNumber(bytes, 48), registrySpan = enigmaNumber(bytes, 56);
  requireEnigma(Number.isFinite(timestamp) && files <= 1 && registry <= 1, "UNSUPPORTED");
  requireEnigma(!files || layout === 3, "UNSUPPORTED");
  requireEnigma(!files || fsOffset >= 64 && fsSpan >= 4 && fsSpan <= size - fsOffset);
  requireEnigma(!registry || registryOffset >= 64 && registrySpan <= size - registryOffset);
  return {timestamp, files: Boolean(files), fsOffset, fsSpan};
}

/** Layout 3 stores one metadata block followed by payloads addressed from its end. */
export async function virtualBoxTree(handle, sourceSize, base, size, signal) {
  const head = await header(handle, sourceSize, base, size, signal);
  if (!head) {return null;}
  if (!head.files) {return {...head, rows: [], metadataBytes: 0};}
  const start = base + head.fsOffset, end = start + head.fsSpan;
  const length = (await readEnigma(handle, sourceSize, start, 4, signal)).readUInt32LE();
  requireEnigma(length >= 15 && length <= enigmaLimits.metadata && length <= head.fsSpan - 4, "LIMIT");
  const metadata = await readEnigma(handle, sourceSize, start + 4, length, signal), payload = start + 4 + length;
  const rows = [], seen = new Map(), stack = [{count: 1, path: "", depth: 0}];
  let at = 0, count = 0, total = 0;
  while (stack.length) {
    signal?.throwIfAborted(); const parent = stack.at(-1);
    if (!parent.count) {stack.pop(); continue;}
    parent.count--; requireEnigma(++count <= enigmaLimits.entries && stack.length <= 128, "LIMIT");
    const level = enigmaRange(metadata, at + 4, 4).readUInt32LE(), children = metadata.readUInt32LE(at + 8);
    const name = cstring(metadata, at + 12), kind = enigmaRange(metadata, name.end, 1)[0], depth = parent.depth;
    requireEnigma(children <= enigmaLimits.entries, "LIMIT"); at = name.end + 1;
    let path = "";
    if (!depth) {requireEnigma(kind === 0 && name.text === "" && level !== 1, "UNSUPPORTED");}
    else if (depth === 1) {requireEnigma(kind === 3 && level === 1 && name.text === defaultFolder, "UNSUPPORTED");}
    else {
      requireEnigma(level !== 1 && !/[\\/%:]/u.test(name.text) && safePath(name.text), "PATH_INVALID");
      path = parent.path ? parent.path + "/" + name.text : name.text; requireEnigma(safePath(path), "PATH_INVALID");
    }
    if (kind === 3) {enigmaRange(metadata, at, 29); at += 29;}
    else if (kind === 2) {
      requireEnigma(depth > 1 && children === 0, "UNSUPPORTED");
      const flags = enigmaRange(metadata, at, 1)[0], registration = metadata[at + 1], sizeBytes = enigmaNumber(metadata, at + 2);
      const action = enigmaRange(metadata, at + 38, 1)[0], target = cstring(metadata, at + 39);
      const offset = enigmaNumber(metadata, target.end), stored = enigmaNumber(metadata, target.end + 8); at = target.end + 16;
      // Compression, registration and redirect actions require their own native evidence.
      requireEnigma(flags === 0 && registration === 0 && action === 0 && target.text === "" && stored === sizeBytes, "UNSUPPORTED");
      requireEnigma(sizeBytes <= enigmaLimits.file && (total += sizeBytes) <= enigmaLimits.tree, "LIMIT");
      requireEnigma(offset <= end - payload && stored <= end - payload - offset);
      const key = path.toUpperCase(), previous = seen.get(key);
      requireEnigma(previous === undefined || previous === kind, "CONFLICT");
      // The native tree keeps the first same-kind sibling and skips later records.
      if (previous === undefined) {seen.set(key, kind); rows.push({name: path, offset: payload + offset, sizeBytes});}
    } else {requireEnigma(kind === 0 && !depth, "UNSUPPORTED");}
    if (kind === 3 && depth > 1) {
      const key = path.toUpperCase(), previous = seen.get(key);
      requireEnigma(previous === undefined || previous === kind, "CONFLICT"); seen.set(key, kind);
    }
    if (children) {requireEnigma(kind !== 2, "UNSUPPORTED"); stack.push({count: children, path, depth: depth + 1});}
  }
  requireEnigma(at === length, "UNSUPPORTED");
  return {...head, rows, metadataBytes: length};
}

function maskFiles(context, prefix, masks) {
  const files = new Map();
  for (const mask of masks) {
    const pattern = "^" + mask.replace(/[.*+?^${}()|[\]\\]/gu, value => value === "*" ? "[^/]*" : value === "?" ? "[^/]" : "\\" + value) + "$";
    const regexp = new RegExp(pattern, "iu");
    for (const file of context.files) {
      if (file.logicalKey.startsWith(prefix) && !file.logicalKey.slice(prefix.length).includes("/") &&
          regexp.test(file.logicalKey.slice(prefix.length))) {files.set(file.logicalKey, file);}
    }
  }
  requireEnigma(files.size <= 64, "LIMIT"); return [...files.values()];
}
async function probe(context) {
  const plans = [];
  for (const file of context.files.filter(file => /\.exe$/iu.test(file.logicalKey))) {
    context.signal?.throwIfAborted();
    const source = requireLocator(context, file), handle = await openContent(source); let loader, internal;
    try {
      loader = await virtualBoxPE(handle, source.sizeBytes, context.signal);
      if (loader) {
        internal = await virtualBoxTree(handle, source.sizeBytes, loader.internal.base, loader.internal.size, context.signal);
        requireEnigma(internal, "UNSUPPORTED");
      }
    } finally {await handle.close();}
    if (!loader) {continue;}
    const prefix = file.logicalKey.includes("/") ? file.logicalKey.slice(0, file.logicalKey.lastIndexOf("/") + 1) : "";
    const packages = [{...internal, sourceKey: file.logicalKey}];
    let candidateRows = internal.rows.length, metadataBytes = internal.metadataBytes;
    for (const item of maskFiles(context, prefix, loader.masks)) {
      if (item.logicalKey === file.logicalKey) {continue;}
      const locator = requireLocator(context, item), handle = await openContent(locator);
      try {
        // Native enumeration ignores matched files without the package signature.
        const found = await virtualBoxTree(handle, locator.sizeBytes, 0, locator.sizeBytes, context.signal);
        if (!found) {continue;}
        requireEnigma((candidateRows += found.rows.length) <= enigmaLimits.entries &&
          (metadataBytes += found.metadataBytes) <= 32 * 1024 * 1024, "LIMIT");
        packages.push({...found, sourceKey: item.logicalKey});
      } finally {await handle.close();}
    }
    const sources = [file, ...packages.filter(pack => pack.sourceKey !== file.logicalKey)
      .map(pack => context.files.find(item => item.logicalKey === pack.sourceKey))];
    // Native adjacent swaps order packages by descending timestamp and are stable for ties.
    const {rows, overrides} = enigmaVirtualRows(context, prefix, packages, sources);
    if (!rows.length) {continue;}
    plans.push({format: "enigma-virtualbox", claims: sources.map(item => item.logicalKey),
      outputs: [...sources.map(item => item.logicalKey), ...rows.map(row => row.logicalKey)], overrides, launchDomain: file.logicalKey,
      file, sources, rows, evidence: {...loader.evidence, externalPackages: sources.length - 1, shadowedVirtualFiles: candidateRows - rows.length}});
  }
  return plans;
}
async function* slice(handle, sourceSize, row, signal) {
  for (let at = 0; at < row.sizeBytes; at += 65536) {yield await readEnigma(handle, sourceSize, row.offset + at, Math.min(65536, row.sizeBytes - at), signal);}
}
async function convert(context, plan) {
  const files = await enigmaConvertPlan(context, plan, slice, "enigma-virtualbox-",
    {packages: plan.sources.map(item => ({logicalKey: item.logicalKey, sha256: item.sha256}))});
  return {files, summary: {archiveCount: plan.sources.length, verifiedEntries: plan.rows.length, details: []}};
}
export const enigmaVirtualBox = Object.freeze({id: "enigma-virtualbox", version: 1, phase: "container", priority: 100,
  platforms: ["kirikiri"], formats: ["enigma-virtualbox"], probe, convert});
