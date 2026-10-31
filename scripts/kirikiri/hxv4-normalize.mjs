import {mkdir, mkdtemp, open, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {openContent, contentStream} from "../runtime-host-content.mjs";
import {requireLocator} from "../runtime-archive-input.mjs";
import {chunk, number64, readExact, requireFormat, resourceBytes, adler32, maximumIndex, maximumTree} from "./bytes.mjs";
import {indexes, parseFile, readXp3} from "./xp3.mjs";
import {convertXp3} from "./convert.mjs";
import {shortWarningShape} from "./warning-metadata.mjs";
import {deriveHxMaterial, decryptHxPayload, parseHxTable, encodeHxNamespace, hxDigest} from "./hxv4-crypto.mjs";
import {discoverHxBootstrap} from "./hxv4-pe.mjs";
import {createHxManager, applyHxState} from "./hxv4-filter.mjs";
import {hxEntryId, selectHxMedia} from "./hxv4-names.mjs";

async function container(file, locator, signal) {
  const handle = await openContent(locator);
  try {
    const rows = await indexes(handle, signal), descriptors = rows.filter(row => row.tag === "Hxv4");
    requireFormat(descriptors.length === 1 && rows.every(row => row.tag === "Hxv4" || row.tag === "File"));
    const descriptor = descriptors[0].bytes; requireFormat(descriptor.length === 14);
    const offset = number64(descriptor), size = descriptor.readUInt32LE(8), flags = descriptor.readUInt16LE(12);
    requireFormat(offset >= 19 && size >= 16 && size <= maximumIndex && (flags & ~1) === 0);
    const payload = await readExact(handle, offset, size), entries = rows.filter(row => row.tag === "File").map(row => parseFile(row.bytes, locator.sizeBytes));
    requireFormat(entries.length > 0 && entries.length <= 250000, "ARCHIVE_LIMIT");
    const names = new Set(); for (const entry of entries) {requireFormat(!names.has(entry.physical)); names.add(entry.physical);}
    return {file, locator, payload, flags, entries, format: "hxv4-decoded", omitted: []};
  } finally {await handle.close();}
}
async function bootstrapProfiles(input) {
  const found = new Map(); let total = 0, unsupported = false;
  for (const file of input.files) {
    input.signal?.throwIfAborted();
    if (file.sizeBytes < 64 || file.sizeBytes > 64 * 1024 * 1024) {continue;}
    const locator = requireLocator(input, file), handle = await openContent(locator); let mz;
    try {mz = (await readExact(handle, 0, 2)).equals(Buffer.from("MZ"));} finally {await handle.close();}
    if (!mz) {continue;} total += file.sizeBytes; requireFormat(total <= 512 * 1024 * 1024, "MODULE_LIMIT");
    const parts = []; for await (const bytes of contentStream(locator, {signal: input.signal})) {parts.push(bytes);}
    const bytes = Buffer.concat(parts); requireFormat(bytes.length === file.sizeBytes && hxDigest(bytes) === file.sha256, "SOURCE_CHANGED");
    let profile;
    try {profile = discoverHxBootstrap(bytes);}
    catch (error) {
      if (["RUNTIME_KIRIKIRI_HXV4_BOOTSTRAP_UNAVAILABLE", "RUNTIME_KIRIKIRI_HXV4_HASHER_UNSUPPORTED"].includes(error.message)) {unsupported = true; continue;}
      throw error;
    }
    if (profile) {found.set(`${profile.bootstrapSha256}:${profile.startupSha256}`, profile); requireFormat(found.size <= 16, "MODULE_LIMIT");}
  }
  requireFormat(found.size > 0 || !unsupported, "HXV4_BOOTSTRAP_UNAVAILABLE"); return [...found.values()];
}
function authenticate(profile, archives, signal) {
  const accepted = new Map();
  for (const prefix of profile.prefixes) {
    for (const seed of profile.seeds) {
      signal?.throwIfAborted(); const material = deriveHxMaterial(profile.params, prefix, profile.warning, profile.unique, seed), decoded = [];
      try {
        for (const archive of archives) {
          const bytes = decryptHxPayload(archive.payload, material.key, archive.flags & 1 ? material.nonce1 : material.nonce0);
          decoded.push({archive, records: parseHxTable(bytes), tableSha256: hxDigest(bytes)});
        }
      } catch (error) {if (error.message === "RUNTIME_KIRIKIRI_HXV4_AUTHENTICATION_FAILED") {continue;} throw error;}
      const mediaName = selectHxMedia(profile, decoded.flatMap(item => item.records));
      const key = `${material.key.toString("hex")}:${material.nonce0.toString("hex")}:${material.nonce1.toString("hex")}`;
      accepted.set(key, {material, decoded, profile, mediaName, prefix, seed});
    }
  }
  return [...accepted.values()];
}
async function warning(archive, entry, record, signal) {
  if (entry.readable === entry.size && entry.segments.reduce((sum, s) => sum + s.packed, 0) === entry.packed) {return;}
  requireFormat(record?.entryId === 0 && shortWarningShape(entry));
  const parts = []; for await (const bytes of resourceBytes(archive.locator, entry, signal)) {parts.push(bytes);}
  const bytes = Buffer.concat(parts); let text;
  try {text = new TextDecoder("shift-jis", {fatal: true}).decode(bytes);} catch {requireFormat(false);}
  requireFormat(bytes.length === entry.readable && text.startsWith("Warning: Extracting this archive may infringe on author's rights.") &&
    [...text].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 || "\r\n\t".includes(c)));
  entry.warningMetadata = true;
}
async function bind(decoded, mediaName, signal) {
  for (const {archive, records} of decoded) {
    const ids = new Map(), bound = new Set();
    for (let i = 0; i < archive.entries.length; i++) {
      const id = hxEntryId(archive.entries[i].physical);
      if (id !== null) {requireFormat(!ids.has(id), "NAME_MAP_INVALID"); ids.set(id, i);}
    }
    for (const record of records) {
      requireFormat(record.archiveSlot === 0 && ids.has(record.entryId) && !bound.has(record.entryId), "NAME_MAP_INVALID");
      bound.add(record.entryId); record.fileIndex = ids.get(record.entryId);
      const entry = archive.entries[record.fileIndex]; entry.hxRecord = record;
      await warning(archive, entry, record, signal);
    }
    requireFormat(bound.size === ids.size, "NAME_MAP_INVALID");
    for (const entry of archive.entries) {if (!entry.hxRecord) {await warning(archive, entry, null, signal);}}
    archive.records = records; archive.extraIndexChunks = [chunk("RHx4", encodeHxNamespace(mediaName, records))];
  }
}
function filterFor(manager) {
  const states = new WeakMap();
  return {kind: "hxv4", verified: true, apply(bytes, seed, offset, entry) {
    if (!entry.hxRecord || entry.warningMetadata) {return bytes;}
    if (!states.has(entry)) {states.set(entry, manager.state(entry.hxRecord.entryKey, entry.hxRecord.localFlags));}
    return applyHxState(bytes, offset, states.get(entry));
  }};
}
async function verifySamples(decoded, filter, signal) {
  const checksums = new Set();
  for (const {archive} of decoded) {
    for (const entry of archive.entries) {
      if (!entry.hxRecord || entry.warningMetadata || entry.readable !== entry.size || entry.size < 32 || entry.size > 4 * 1024 * 1024 || checksums.has(entry.adler)) {continue;}
      let size = 0, checksum = 1;
      for await (const bytes of resourceBytes(archive.locator, entry, signal)) {filter.apply(bytes, undefined, size, entry); size += bytes.length; checksum = adler32(bytes, checksum);}
      requireFormat(size === entry.size && checksum === entry.adler, "CHECKSUM_MISMATCH"); checksums.add(checksum);
      if (checksums.size === 3) {return;}
    }
  }
  throw new Error("RUNTIME_KIRIKIRI_FILTER_UNAVAILABLE");
}
async function probe(input) {
  const pending = [];
  for (const file of input.files) {
    const locator = requireLocator(input, file), key = `xp3:${file.logicalKey}`;
    if (!input.cache.has(key)) {input.cache.set(key, readXp3(locator, {signal: input.signal}));}
    const result = await input.cache.get(key);
    if (result?.unsupportedFormat === "hxv4") {pending.push({file, locator});}
  }
  if (!pending.length) {return [];}
  const profiles = await bootstrapProfiles(input); if (!profiles.length) {return [];}
  const archives = [];
  for (const {file, locator} of pending) {archives.push(await container(file, locator, input.signal));}
  const accepted = profiles.flatMap(profile => authenticate(profile, archives, input.signal));
  requireFormat(accepted.length > 0, "HXV4_BOOTSTRAP_UNAVAILABLE"); requireFormat(accepted.length === 1, "FILTER_AMBIGUOUS");
  const selected = accepted[0]; await bind(selected.decoded, selected.mediaName, input.signal);
  const filter = filterFor(createHxManager(selected.material)); await verifySamples(selected.decoded, filter, input.signal);
  const claims = archives.map(a => a.file.logicalKey);
  return [{format: "hxv4-decoded", claims, outputs: claims, archives, filter, selected}];
}
async function convert(input, plan) {
  const root = await mkdtemp(join(input.outputRoot, ".audit-")), log = await open(join(root, "entries.jsonl"), "wx", 0o600);
  const summary = {archiveCount: plan.archives.length, verifiedEntries: 0, metadataCorrections: 0, omittedPhysicalEntries: 0, warnings: [], details: []}, files = [];
  let total = input.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const audit = async row => {
    await log.write(JSON.stringify(row) + "\n");
    if (row.corrections?.length) {summary.details.push({code: row.corrections[0], file: row.archive, member: row.physicalName,
      sourceSha256: row.rawStreamSha256, outputSha256: row.outputSha256, sourceSize: row.sourceSize, outputSize: row.outputSize});}
  };
  try {
    for (const archive of plan.archives) {
      const {file} = archive, path = join(input.outputRoot, file.logicalKey); await mkdir(dirname(path), {recursive: true});
      const result = await convertXp3(archive, file, path, plan.filter, audit, input.signal);
      files.push({logicalKey: file.logicalKey, name: file.name, path, sizeBytes: result.sizeBytes, sha256: result.sha256});
      total += result.sizeBytes - file.sizeBytes; requireFormat(total <= maximumTree, "ARCHIVE_LIMIT");
      for (const key of ["verifiedEntries", "metadataCorrections"]) {summary[key] += result[key];}
      await audit({kind: "hxv4-namespace", archive: file.logicalKey, sourceSha256: file.sha256, outputSha256: result.sha256,
        payloadSha256: hxDigest(archive.payload), tableSha256: plan.selected.decoded.find(d => d.archive === archive).tableSha256,
        namespaceSha256: hxDigest(archive.extraIndexChunks[0]), mediaName: plan.selected.mediaName, descriptorFlags: archive.flags,
        sourceModuleSha256: plan.selected.profile.sourceModuleSha256, bootstrapSha256: plan.selected.profile.bootstrapSha256,
        records: archive.records.map(r => ({...r, pathHash: r.pathHash.toString("hex"), fileHash: r.fileHash.toString("hex"), entryKey: r.entryKey.toString(16)}))});
    }
    if (summary.metadataCorrections) {summary.warnings.push({code: "SOURCE_METADATA_CORRECTED", count: summary.metadataCorrections});}
    await log.sync(); await writeFile(join(root, "summary.json"), JSON.stringify(summary) + "\n", {flag: "wx", mode: 0o600});
  } finally {await log.close();}
  return {files, summary};
}
export const hxv4 = Object.freeze({id: "kirikiri-hxv4", version: 1, priority: 110, platforms: ["kirikiri"], formats: ["hxv4-decoded"], probe, convert});
