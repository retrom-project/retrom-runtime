import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {posix, join} from "node:path";
import {kirikiriEntry, kirikiriArchiveProbeBytes, kirikiriPatchLaunches} from "../../dist/runtime/index.js";
import {contentStream, openContent, readContent} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {readExact} from "../kirikiri/bytes.mjs";
import {probeXmoeCompanion} from "./xmoe-pe.mjs";
import {inspectXmoeHeader, inspectXmoeArchive, decodeXmoePayload, xmoeLimits} from "./xmoe-codec.mjs";
import {requireXmoe} from "./xmoe-common.mjs";
import {normalizationDestination, verifyNormalizationSource} from "./output.mjs";

const fact = file => ({logicalKey: file.logicalKey, sizeBytes: file.sizeBytes, sha256: file.sha256});
const prefix = path => path.slice(0, path.lastIndexOf("/") + 1);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function companionArchive(files, projectRoot, name) {
  const candidates = files.filter(file => posix.basename(file.logicalKey).toUpperCase() === name.toUpperCase() &&
    prefix(file.logicalKey) === projectRoot);
  requireXmoe(candidates.length > 0, "RUNTIME_XMOE_ARCHIVE_MISSING");
  requireXmoe(candidates.length === 1, "RUNTIME_NORMALIZATION_LAUNCH_AMBIGUOUS");
  return candidates[0];
}

async function projectEntry(input) {
  const cached = input.cache.get("xmoe-project-entry");
  if (cached) {return cached;}
  const evidence = {};
  for (const file of input.files) {
    input.signal?.throwIfAborted();
    if (file.sizeBytes < kirikiriArchiveProbeBytes) {continue;}
    const chunks = [];
    for await (const chunk of contentStream(requireLocator(input, file), {length: kirikiriArchiveProbeBytes, signal: input.signal})) {chunks.push(chunk);}
    evidence[file.logicalKey] = {prefixBase64: Buffer.concat(chunks).toString("base64")};
  }
  const entry = kirikiriEntry({files: input.files, evidence});
  input.cache.set("xmoe-project-entry", entry); return entry;
}

async function priorOutputs(input, plan) {
  const reserved = input.files.filter(file => file.logicalKey === plan.manifest || file.logicalKey.startsWith(plan.overlayRoot + "/"));
  if (!reserved.length) {return [];}
  const previous = reserved.find(file => file.logicalKey === plan.manifest);
  requireXmoe(previous && previous.sizeBytes <= 256 * 1024, "RUNTIME_NORMALIZATION_CONFLICT");
  const bytes = await readContent(requireLocator(input, previous));
  requireXmoe(digest(bytes) === previous.sha256, "RUNTIME_CONTENT_CHANGED");
  const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  kirikiriPatchLaunches({files: input.files, evidence: {[plan.manifest]: {text}},
    configuration: {content: {kind: "KIRIKIRI_PROJECT", entryFile: plan.entryFile}}});
  const manifest = JSON.parse(text), sources = [plan.module, plan.archive].map(fact);
  requireXmoe(manifest.overlayRoot === plan.overlayRoot && manifest.sourceFiles.length === sources.length &&
    sources.every(source => manifest.sourceFiles.some(file => file.logicalKey === source.logicalKey &&
      file.sizeBytes === source.sizeBytes && file.sha256 === source.sha256)), "RUNTIME_NORMALIZATION_CONFLICT");
  requireXmoe(reserved.every(file => plan.outputs.includes(file.logicalKey)), "RUNTIME_NORMALIZATION_CONFLICT");
  return reserved.map(file => file.logicalKey);
}

async function probe(input) {
  const plans = [];
  for (const module of input.files) {
    input.signal?.throwIfAborted();
    if (!/\.(?:exe|dll|tpm)$/iu.test(module.logicalKey) || module.sizeBytes < 64 || module.sizeBytes > xmoeLimits.image) {continue;}
    const bytes = await readContent(requireLocator(input, module));
    requireXmoe(digest(bytes) === module.sha256, "RUNTIME_CONTENT_CHANGED");
    const profile = probeXmoeCompanion(bytes, input.signal);
    if (!profile) {continue;}
    const entryFile = await projectEntry(input), projectRoot = prefix(entryFile);
    requireXmoe(module.logicalKey.startsWith(projectRoot), "RUNTIME_NORMALIZATION_LAUNCH_AMBIGUOUS");
    const archive = companionArchive(input.files, projectRoot, profile.archiveName), source = requireLocator(input, archive);
    const handle = await openContent(source); let rows;
    try {
      const header = await readExact(handle, 0, 24), meta = inspectXmoeHeader(header, profile, archive.sizeBytes);
      rows = inspectXmoeArchive(header, await readExact(handle, meta.offset, meta.packed), profile, archive.sizeBytes, input.signal);
    } finally {await handle.close();}
    const relativeRoot = ".runtime-patches/" + posix.basename(module.logicalKey);
    const overlayRoot = projectRoot + relativeRoot, manifest = projectRoot + ".runtime-launches/" + posix.basename(module.logicalKey) + ".json";
    requireXmoe(rows.length <= 10000 && relativeRoot.length <= 240, "RUNTIME_XMOE_LIMIT");
    rows = rows.map(row => ({...row, logicalKey: overlayRoot + "/" + row.name}));
    const outputs = [module.logicalKey, archive.logicalKey, manifest, ...rows.map(row => row.logicalKey)];
    requireXmoe(outputs.every(safePath) && new Set(outputs.map(path => path.toUpperCase())).size === outputs.length,
      "RUNTIME_NORMALIZATION_CONFLICT");
    const plan = {format: "xmoe-psb", claims: [module.logicalKey, archive.logicalKey], outputs, launchDomain: module.logicalKey,
      module, archive, entryFile, projectRoot, overlayRoot, manifest, profile, rows};
    plan.overrides = await priorOutputs(input, plan); plans.push(plan);
  }
  return plans;
}

async function convert(input, plan) {
  const sources = [plan.module, plan.archive], files = [], resources = [];
  for (const source of sources) {
    const locator = requireLocator(input, source);
    await verifyNormalizationSource(locator, source.sha256, input.signal);
    const copy = await normalizationDestination(input, source.logicalKey, contentStream(locator, {signal: input.signal}));
    requireXmoe(copy.sha256 === source.sha256 && copy.sizeBytes === source.sizeBytes, "RUNTIME_CONTENT_CHANGED"); files.push(copy);
  }
  const handle = await openContent(requireLocator(input, plan.archive)); let total = 0;
  try {
    for (const row of plan.rows) {
      input.signal?.throwIfAborted();
      const decoded = decodeXmoePayload(await readExact(handle, row.offset, row.packed), plan.profile, input.signal);
      total += decoded.length; requireXmoe(total <= xmoeLimits.tree, "RUNTIME_XMOE_LIMIT");
      const file = await normalizationDestination(input, row.logicalKey, [decoded]); files.push(file); resources.push(fact(file));
    }
  } finally {await handle.close();}
  const manifest = Buffer.from(JSON.stringify({kind: "KIRIKIRI_RESOURCE_PATCH", version: 1,
    sourceFiles: sources.map(fact), overlayRoot: plan.overlayRoot, resources}));
  requireXmoe(manifest.length <= 256 * 1024, "RUNTIME_XMOE_LIMIT");
  files.push(await normalizationDestination(input, plan.manifest, [manifest]));
  for (const source of sources) {await verifyNormalizationSource(requireLocator(input, source), source.sha256, input.signal);}
  await mkdir(input.auditRoot, {recursive: true});
  const audit = {format: plan.format, sources: sources.map(fact), nativeProfile: plan.profile.evidence,
    resources, nativeCodeExecuted: false, translationLanguageVerified: false};
  await writeFile(join(input.auditRoot, "xmoe-" + digest(Buffer.from(plan.module.logicalKey)) + ".json"), JSON.stringify(audit, null, 2));
  return {files, summary: {archiveCount: 1, verifiedEntries: resources.length,
    details: [{code: "STATIC_RESOURCE_PATCH", file: plan.module.logicalKey, member: plan.manifest}]}};
}

export const xmoeResourcePatch = Object.freeze({id: "xmoe-psb", version: 1, phase: "container", priority: 110,
  platforms: ["kirikiri"], formats: ["xmoe-psb"], probe, convert});
