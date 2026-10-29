import {mkdir, mkdtemp, open, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createHash} from "node:crypto";
import {contentStream} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {maximumTree, requireFormat, resourceBytes, adler32, sourceHash} from "./bytes.mjs";
import {readXp3} from "./xp3.mjs";
import {convertXp3} from "./convert.mjs";
import {fixedXorArchive, ordinaryArchive} from "./ordinary.mjs";
import {peXp3} from "./pe-xp3.mjs";
import {discoverCxProfiles, discoverTinyProfiles, extractEmbeddedPeModules, createCxFilter, createTinyFilter} from "./cxdec.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function tinyFilter(profile) {
  return {kind: "tiny", profile, ...createTinyFilter(profile)};
}
function profileKey(profile) {
  if (profile.kind === "tiny") {
    const p = profile.profile, value = p.xorConstant;
    const first = p.firstByte ? `${value & 255}:${p.firstByte.zeroFallback}` : "none";
    return `tiny:${(value ^ (value >>> 8) ^ (value >>> 16) ^ (value >>> 24)) & 255}:${p.zeroFallback}:${first}`;
  }
  const p = profile.profile;
  return `classic:${p.mask}:${p.offset}:${p.prologOrder}:${p.evenBranchOrder}:${p.oddBranchOrder}:${digest(p.controlBlock)}`;
}
async function nativeProfiles(input, signal, archives = []) {
  const profiles = new Map(), visited = new Set(); let totalBytes = 0, moduleCount = 0;
  function inspect(bytes, depth = 0) {
    const sha256 = digest(bytes);
    if (visited.has(sha256)) {return;}
    visited.add(sha256); totalBytes += bytes.length; moduleCount++;
    requireFormat(depth <= 3 && moduleCount <= 512 && totalBytes <= 512 * 1024 * 1024, "MODULE_LIMIT");
    const found = [...discoverCxProfiles(bytes).map(profile => ({kind: "classic", profile})),
      ...discoverTinyProfiles(bytes).map(profile => ({kind: "tiny", profile}))];
    for (const value of found) {profiles.set(profileKey(value), {...value, moduleSha256: sha256});}
    requireFormat(profiles.size <= 64, "FILTER_AMBIGUOUS");
    for (const embedded of extractEmbeddedPeModules(bytes, {maxTotalBytes: 512 * 1024 * 1024 - totalBytes})) {inspect(embedded, depth + 1);}
  }
  for (const file of input.files) {
    signal?.throwIfAborted();
    if (!/\.(?:exe|dll|tpm)$/iu.test(file.logicalKey) || file.sizeBytes === 0) {continue;}
    requireFormat(file.sizeBytes <= 64 * 1024 * 1024, "MODULE_LIMIT");
    const chunks = []; let size = 0;
    for await (const bytes of contentStream(requireLocator(input, file), {signal})) {size += bytes.length; chunks.push(bytes);}
    requireFormat(size === file.sizeBytes, "SOURCE_CHANGED");
    const bytes = Buffer.concat(chunks, size); requireFormat(digest(bytes) === file.sha256, "SOURCE_CHANGED");
    inspect(bytes);
  }
  for (const {archive, file} of archives) {
    requireFormat(await sourceHash(archive.sourceLocator ?? archive.locator, signal) === file.sha256, "SOURCE_CHANGED");
    for (const entry of archive.entries) {
      signal?.throwIfAborted();
      if (!/\.(?:exe|dll|tpm)$/iu.test(entry.name) || entry.flags !== 0 || !entry.size) {continue;}
      requireFormat(entry.size <= 64 * 1024 * 1024, "MODULE_LIMIT");
      const chunks = [];
      for await (const bytes of resourceBytes(archive.locator, entry, signal)) {chunks.push(bytes);}
      inspect(Buffer.concat(chunks), 1);
    }
  }
  return [...profiles.values()];
}
async function samples(archives, signal) {
  const result = [], seeds = new Set();
  for (const archive of archives) {
    for (const entry of archive.entries) {
      if (entry.size < 32 || entry.size > 4 * 1024 * 1024 || entry.size !== entry.readable || entry.reusedSeed || entry.seedOnly || seeds.has(entry.h) ||
          archive.format === "xp3-native" && entry.flags !== 0x80000000) {continue;}
      const chunks = []; let size = 0;
      for await (const bytes of resourceBytes(archive.locator, entry, signal)) {size += bytes.length; chunks.push(bytes);}
      result.push({h: entry.h, adler: entry.adler, bytes: Buffer.concat(chunks, size)}); seeds.add(entry.h);
      if (result.length === 8) {return result;}
    }
  }
  requireFormat(result.length > 0, "FILTER_UNAVAILABLE"); return result;
}
async function selectFilter(profiles, archives, signal) {
  const probes = await samples(archives, signal), accepted = [];
  for (const candidate of profiles) {
    signal?.throwIfAborted();
    let filter;
    try {filter = candidate.kind === "tiny" ? tinyFilter(candidate.profile) : {kind: "classic", ...createCxFilter(candidate.profile)};}
    catch {continue;}
    if (probes.every(sample => {
      const bytes = Buffer.from(sample.bytes); filter.apply(bytes, sample.h, 0);
      return adler32(bytes) === sample.adler;
    })) {accepted.push({...filter, verified: probes.length >= 3, inputProfile: candidate});}
  }
  requireFormat(accepted.length > 0, "FILTER_UNAVAILABLE"); requireFormat(accepted.length === 1, "FILTER_AMBIGUOUS");
  return accepted[0];
}
/** One whole-game probe produces a plan per related archive group. */
async function probe(input) {
  const {signal} = input, groups = new Map(), plans = [], native = [];
  const add = (file, archive, filter, format = archive.format) => plans.push({format, claims: [file.logicalKey], outputs: [file.logicalKey], archives: [{file, archive}], filter});
  for (const file of input.files) {
    signal?.throwIfAborted(); requireFormat(safePath(file.logicalKey));
    const key = `xp3:${file.logicalKey}`;
    if (!input.cache.has(key)) {input.cache.set(key, readXp3(requireLocator(input, file), {signal}));}
    const archive = await input.cache.get(key);
    if (!archive?.format) {
      const embedded = !archive ? await peXp3(requireLocator(input, file), signal) : null;
      const plain = embedded ?? (archive && !archive.unsupportedFormat ? await ordinaryArchive(requireLocator(input, file), signal) : null);
      if (plain) {
        const seedOnly = plain.entries.length > 1 && plain.entries.every(entry => entry.flags === 0 && entry.adler === 0);
        for (const entry of plain.entries) {entry.seedOnly = seedOnly;}
        const fixed = await fixedXorArchive(plain.locator, signal, plain);
        if (fixed && !fixed.plaintext) {add(file, fixed.archive, fixed.filter, embedded ? "xp3-pe" : fixed.archive.format);}
        else if (!fixed?.plaintext && plain.entries.some(entry => entry.flags === 0x80000000 || entry.seedOnly)) {
          native.push({file, archive: {...plain, format: "xp3-native"}, embedded: Boolean(embedded)});
        } else if (embedded) {add(file, plain, {kind: "identity", verified: true, inputProfile: {profile: {}}, apply: bytes => bytes}, "xp3-pe");}
      }
      continue;
    }
    const group = `${archive.format}\0${archive.salt}`;
    if (!groups.has(group)) {groups.set(group, []);}
    groups.get(group).push({file, archive});
  }
  if (!groups.size && !plans.length && !native.length) {return [];}
  requireFormat(!input.files.some(file => /(?:^|\/)xp3filter\.tjs$/iu.test(file.logicalKey)), "ARCHIVE_UNSUPPORTED");
  if (!groups.size && !native.length) {return plans;}
  if (!input.cache.has("cxfilterfs:profiles")) {input.cache.set("cxfilterfs:profiles", nativeProfiles(input, signal, native));}
  const profiles = await input.cache.get("cxfilterfs:profiles");
  for (const archives of groups.values()) {
    const filter = await selectFilter(profiles, archives.map(item => item.archive), signal);
    const claims = archives.map(item => item.file.logicalKey);
    plans.push({format: archives[0].archive.format, claims, outputs: claims, archives, filter});
  }
  if (native.length && profiles.length) {
    const filter = await selectFilter(profiles, native.map(item => item.archive), signal);
    requireFormat(filter.verified, "FILTER_UNAVAILABLE");
    const apply = filter.apply;
    const ordinaryFilter = {...filter, apply(bytes, h, offset, entry) {
      return !entry || entry.flags === 0x80000000 || entry.seedOnly ? apply(bytes, h, offset) : bytes;
    }};
    for (const {file, archive, embedded} of native) {add(file, archive, ordinaryFilter, embedded ? "xp3-pe" : "xp3-native");}
  } else {requireFormat(!native.some(item => item.embedded), "FILTER_UNAVAILABLE");}
  return plans;
}

/** Conversion writes resources only; the common pipeline validates and packages once. */
async function convert(input, plan) {
  const {signal} = input;
  const auditRoot = await mkdtemp(join(input.outputRoot, ".audit-")), log = await open(join(auditRoot, "entries.jsonl"), "wx", 0o600);
  const details = []; let detailBytes = 0;
  const audit = async row => {
    await log.write(JSON.stringify(row) + "\n");
    const codes = row.corrections ?? (row.kind === "physical-only" ? ["OUTSIDE_LOGICAL_NAMESPACE"] : []);
    for (const code of codes) {
      const detail = {code, file: row.archive, member: row.logicalName ?? row.physicalName,
        sourceSha256: row.rawStreamSha256, outputSha256: row.outputSha256,
        sourceSize: row.sourceSize, outputSize: row.outputSize ?? row.readableSize,
        seed: row.sourceSeed, sourceChecksum: row.sourceAdler32, outputChecksum: row.outputAdler32};
      detailBytes += Buffer.byteLength(JSON.stringify(detail));
      requireFormat(details.length < 2048 && detailBytes <= 4 * 1024 * 1024 - 65536, "AUDIT_LIMIT"); details.push(detail);
    }
  };
  const files = [], summary = {archiveCount: plan.archives.length, verifiedEntries: 0, metadataCorrections: 0,
    omittedPhysicalEntries: 0, warnings: [], details};
  let total = input.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  try {
    for (const {file, archive} of plan.archives) {
      const path = join(input.outputRoot, file.logicalKey); await mkdir(dirname(path), {recursive: true});
      const {filter} = plan, result = await convertXp3(archive, file, path, filter, audit, signal);
      total += result.sizeBytes - file.sizeBytes; requireFormat(total <= maximumTree, "ARCHIVE_LIMIT");
      files.push({logicalKey: file.logicalKey, name: file.name, sizeBytes: result.sizeBytes, sha256: result.sha256, path});
      for (const key of ["verifiedEntries", "metadataCorrections", "omittedPhysicalEntries"]) {summary[key] += result[key];}
      await audit({archive: file.logicalKey, kind: "archive", format: archive.format, sourceSha256: file.sha256, sourceSize: file.sizeBytes,
        outputSha256: result.sha256, outputSize: result.sizeBytes, filterKind: filter.kind, moduleSha256: filter.inputProfile.moduleSha256,
        profile: ["fixed-xor", "identity"].includes(filter.kind) ? filter.inputProfile.profile : filter.kind === "tiny" ? filter.profile : {...filter.inputProfile.profile, controlBlock: undefined,
          controlBlockSha256: digest(filter.inputProfile.profile.controlBlock)}});
    }
    if (summary.metadataCorrections) {summary.warnings.push({code: "SOURCE_METADATA_CORRECTED", count: summary.metadataCorrections});}
    if (summary.omittedPhysicalEntries) {summary.warnings.push({code: "OUTSIDE_LOGICAL_NAMESPACE", count: summary.omittedPhysicalEntries});}
    await log.sync(); await writeFile(join(auditRoot, "summary.json"), JSON.stringify(summary) + "\n", {flag: "wx", mode: 0o600});
  } finally {await log.close();}
  return {files, summary};
}

export const cxFilterFS = Object.freeze({id: "kirikiri-cxfilterfs", version: 1, priority: 100, platforms: ["kirikiri"],
  formats: ["cxfilterfs-elif", "cxfilterfs-hnfn", "cxfilterfs-yuzu", "cxfilterfs-neko", "cxfilterfs-sen", "xp3-fixed-xor", "xp3-pe", "xp3-native"], probe, convert});
