import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {openContent, contentStream} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {enigmaPE} from "./enigma-pe.mjs";
import {enigmaExternalConfig} from "./enigma-external.mjs";
import {enigmaVFS, enigmaResource} from "./enigma-vfs.mjs";
import {enigmaLimits, requireEnigma} from "./enigma-codec.mjs";
import {normalizationDestination as destination, verifyNormalizationSource as verifySource} from "./output.mjs";

function externalFiles(context, prefix, masks) {
  const files = new Map();
  for (const mask of masks) {
    requireEnigma(mask.startsWith("%DEFAULT FOLDER%\\"), "UNSUPPORTED");
    const relative = mask.slice(17).replace(/\\/gu, "/");
    requireEnigma(relative && relative.split("/").every(part => part && part !== "." && part !== "..") &&
      !/[:%]/u.test(relative) && [...relative].every(character => character.charCodeAt(0) >= 32), "PATH_INVALID");
    const pattern = "^" + (prefix + relative).replace(/[.*+?^${}()|[\]\\]/gu, value => value === "*" ? "[^/]*" : value === "?" ? "[^/]" : "\\" + value) + "$";
    const regexp = new RegExp(pattern, "iu");
    for (const file of context.files) {if (regexp.test(file.logicalKey)) {files.set(file.logicalKey, file);}}
  }
  requireEnigma(files.size <= 64, "LIMIT"); return [...files.values()];
}
async function probe(context) {
  const plans = [];
  for (const file of context.files.filter(file => /\.exe$/iu.test(file.logicalKey))) {
    context.signal?.throwIfAborted();
    const source = requireLocator(context, file), handle = await openContent(source); let profile, directory, external;
    try {
      profile = await enigmaPE(handle, source.sizeBytes, context.signal);
      if (profile) {
        directory = await enigmaVFS(handle, source.sizeBytes, profile, context.signal);
        external = await enigmaExternalConfig(handle, source.sizeBytes, profile.protectedConfiguration, context.signal);
      }
    } finally {await handle.close();}
    if (!profile) {continue;}
    const prefix = file.logicalKey.includes("/") ? file.logicalKey.slice(0, file.logicalKey.lastIndexOf("/") + 1) : "";
    const sources = [file, ...externalFiles(context, prefix, external.masks)];
    requireEnigma(new Set(sources.map(item => item.logicalKey)).size === sources.length, "CONFLICT");
    const packages = [{...directory, sourceKey: file.logicalKey}];
    let candidateRows = directory.rows.length, metadataBytes = directory.metadataBytes;
    for (const item of sources.slice(1)) {
      const locator = requireLocator(context, item), handle = await openContent(locator);
      try {
        const found = await enigmaVFS(handle, locator.sizeBytes, {...external, base: 0, packageSize: locator.sizeBytes,
          compressed: profile.compressed}, context.signal);
        requireEnigma((candidateRows += found.rows.length) <= enigmaLimits.entries &&
          (metadataBytes += found.metadataBytes) <= 32 * 1024 * 1024, "LIMIT");
        packages.push({...found, sourceKey: item.logicalKey});
      } finally {await handle.close();}
    }
    // Stable descending package timestamps match the native adjacent-swap
    // ordering. Its directory loader keeps the first same-kind/name node.
    packages.sort((a, b) => b.timestamp - a.timestamp);
    const virtualNames = new Set(), selected = [];
    for (const pack of packages) for (const row of pack.rows) {
      const key = row.name.toUpperCase(); if (virtualNames.has(key)) {continue;}
      virtualNames.add(key); selected.push({...row, sourceKey: pack.sourceKey});
    }
    const existing = new Map(), overrides = [];
    for (const item of context.files) {
      const key = item.logicalKey.toUpperCase(); requireEnigma(!existing.has(key), "CONFLICT"); existing.set(key, item.logicalKey);
    }
    const rows = selected.map(row => {
      const target = prefix + row.name, key = target.toUpperCase(), old = existing.get(key);
      requireEnigma(safePath(target) && !sources.some(item => key === item.logicalKey.toUpperCase()), "PATH_INVALID");
      if (old) {overrides.push(old);} return {...row, logicalKey: old ?? target};
    });
    plans.push({format: "enigma-protector-vfs", claims: sources.map(item => item.logicalKey), outputs: [...sources.map(item => item.logicalKey), ...rows.map(row => row.logicalKey)],
      overrides, launchDomain: file.logicalKey, file, sources, rows, evidence: {...profile.evidence, external: external.evidence,
        externalPackages: sources.length - 1, shadowedVirtualFiles: candidateRows - rows.length}});
  }
  return plans;
}
async function convert(context, plan) {
  const files = [];
  for (const item of plan.sources) {
    const source = requireLocator(context, item); await verifySource(source, item.sha256, context.signal);
    files.push(await destination(context, item.logicalKey, contentStream(source, {signal: context.signal})));
    const handle = await openContent(source);
    try {
      for (const row of plan.rows.filter(row => row.sourceKey === item.logicalKey)) {
        const output = await destination(context, row.logicalKey, enigmaResource(handle, source.sizeBytes, row, context.signal));
        requireEnigma(output.sizeBytes === row.sizeBytes); files.push(output);
      }
    } finally {await handle.close();}
    await verifySource(source, item.sha256, context.signal);
  }
  const audit = {format: plan.format, file: plan.file.logicalKey, sourceSha256: plan.file.sha256, ...plan.evidence,
    extractedFiles: plan.rows.length, overrides: plan.overrides, nativeCodeExecuted: false};
  await mkdir(context.auditRoot, {recursive: true});
  await writeFile(join(context.auditRoot, "enigma-" + createHash("sha256").update(plan.file.logicalKey).digest("hex") + ".json"), JSON.stringify(audit, null, 2));
  return {files, summary: {archiveCount: 1, verifiedEntries: plan.rows.length, details: []}};
}
export const enigmaProtector = Object.freeze({id: "enigma-protector-vfs", version: 1, phase: "container", priority: 100,
  platforms: ["kirikiri"], formats: ["enigma-protector-vfs"], probe, convert});
