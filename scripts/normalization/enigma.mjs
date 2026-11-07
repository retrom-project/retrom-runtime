import {openContent} from "../runtime-host-content.mjs";
import {requireLocator} from "../runtime-archive-input.mjs";
import {enigmaPE} from "./enigma-pe.mjs";
import {enigmaExternalConfig} from "./enigma-external.mjs";
import {enigmaVFS, enigmaResource} from "./enigma-vfs.mjs";
import {enigmaLimits, requireEnigma} from "./enigma-codec.mjs";
import {enigmaConvertPlan, enigmaVirtualRows} from "./enigma-plan.mjs";

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
    const {rows, overrides} = enigmaVirtualRows(context, prefix, packages, sources);
    plans.push({format: "enigma-protector-vfs", claims: sources.map(item => item.logicalKey), outputs: [...sources.map(item => item.logicalKey), ...rows.map(row => row.logicalKey)],
      overrides, launchDomain: file.logicalKey, file, sources, rows, evidence: {...profile.evidence, external: external.evidence,
        externalPackages: sources.length - 1, shadowedVirtualFiles: candidateRows - rows.length}});
  }
  return plans;
}
async function convert(context, plan) {
  const files = await enigmaConvertPlan(context, plan, enigmaResource, "enigma-", {});
  return {files, summary: {archiveCount: 1, verifiedEntries: plan.rows.length, details: []}};
}
export const enigmaProtector = Object.freeze({id: "enigma-protector-vfs", version: 1, phase: "container", priority: 100,
  platforms: ["kirikiri"], formats: ["enigma-protector-vfs"], probe, convert});
