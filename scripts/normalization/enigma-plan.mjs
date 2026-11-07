import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {openContent, contentStream} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {requireEnigma} from "./enigma-codec.mjs";
import {normalizationDestination as destination, verifyNormalizationSource as verifySource} from "./output.mjs";

/**
 * Both Enigma loaders order packages by descending timestamp with stable ties
 * and keep the first virtual file for a case-insensitive path. Virtual files
 * beside the executable replace same-path physical files, never a package source.
 */
export function enigmaVirtualRows(context, prefix, packages, sources) {
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
  return {rows, overrides};
}

/** Copy every package source unchanged, then stream its selected virtual files. */
export async function enigmaConvertPlan(context, plan, resource, auditPrefix, audit) {
  const files = [];
  for (const item of plan.sources) {
    const source = requireLocator(context, item); await verifySource(source, item.sha256, context.signal);
    files.push(await destination(context, item.logicalKey, contentStream(source, {signal: context.signal})));
    const handle = await openContent(source);
    try {
      for (const row of plan.rows.filter(row => row.sourceKey === item.logicalKey)) {
        const output = await destination(context, row.logicalKey, resource(handle, source.sizeBytes, row, context.signal));
        requireEnigma(output.sizeBytes === row.sizeBytes); files.push(output);
      }
    } finally {await handle.close();}
    await verifySource(source, item.sha256, context.signal);
  }
  await mkdir(context.auditRoot, {recursive: true});
  await writeFile(join(context.auditRoot, auditPrefix + createHash("sha256").update(plan.file.logicalKey).digest("hex") + ".json"),
    JSON.stringify({format: plan.format, file: plan.file.logicalKey, sourceSha256: plan.file.sha256, ...plan.evidence, ...audit,
      extractedFiles: plan.rows.length, overrides: plan.overrides, nativeCodeExecuted: false}, null, 2));
  return files;
}
