import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {openContent, contentStream} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {requireMolebox, readMoleboxAt, decodeMolebox, inflateMoleboxBlock, moleboxCRC16} from "./molebox-codec.mjs";
import {inspectMolebox} from "./molebox-vfs.mjs";
import {normalizationDestination as destination, verifyNormalizationSource as verifySource} from "./output.mjs";

const folded = value => value.toUpperCase();
async function probe(context) {
  const plans = [];
  for (const file of context.files.filter(file => /\.exe$/iu.test(file.logicalKey))) {
    context.signal?.throwIfAborted();
    const source = requireLocator(context, file), handle = await openContent(source);
    let index;
    try {index = await inspectMolebox(handle, source.sizeBytes, context.signal);} finally {await handle.close();}
    if (!index) {continue;}
    const prefix = file.logicalKey.includes("/") ? file.logicalKey.slice(0, file.logicalKey.lastIndexOf("/") + 1) : "";
    const existing = new Map();
    for (const item of context.files) {
      const key = folded(item.logicalKey); requireMolebox(!existing.has(key), "RUNTIME_NORMALIZATION_CONFLICT"); existing.set(key, item.logicalKey);
    }
    const overrides = [];
    const rows = index.rows.map(row => {
      const target = prefix + row.name; requireMolebox(safePath(target), "RUNTIME_MOLEBOX_PATH_INVALID");
      const previous = existing.get(folded(target));
      requireMolebox(folded(target) !== folded(file.logicalKey), "RUNTIME_NORMALIZATION_CONFLICT");
      // The supported node flags have neither native physical-file fallback
      // bit. Their paths shadow the external file in this executable's domain.
      if (previous) {overrides.push(previous);}
      return {...row, logicalKey: previous ?? target};
    });
    const outputs = [file.logicalKey, ...rows.map(row => row.logicalKey)];
    requireMolebox(new Set(outputs.map(folded)).size === outputs.length, "RUNTIME_NORMALIZATION_CONFLICT");
    plans.push({format: "molebox4-steelbox", claims: [file.logicalKey], outputs, overrides,
      launchDomain: file.logicalKey, file, rows, evidence: index.evidence});
  }
  return plans;
}
async function *resourceBlocks(input, source, row) {
  const handle = await openContent(source);
  try {
    let length = 0;
    for (const block of row.blocks) {
      input.signal?.throwIfAborted();
      let bytes = await readMoleboxAt(handle, source.sizeBytes, block.offset, block.packed, input.signal);
      if (block.flags & 4) {bytes = decodeMolebox(bytes, row.key, row.table);}
      if (block.flags & 2) {bytes = inflateMoleboxBlock(bytes, block.sizeBytes);}
      else {bytes = bytes.subarray(0, block.sizeBytes);}
      requireMolebox(bytes.length === block.sizeBytes && moleboxCRC16(bytes) === block.crc16);
      length += bytes.length; requireMolebox(length <= row.sizeBytes); yield bytes;
    }
    requireMolebox(length === row.sizeBytes);
  } finally {await handle.close();}
}
async function convert(context, plan) {
  const source = requireLocator(context, plan.file);
  await verifySource(source, plan.file.sha256, context.signal);
  const files = [await destination(context, plan.file.logicalKey, contentStream(source, {signal: context.signal}))];
  requireMolebox(files[0].sizeBytes === plan.file.sizeBytes && files[0].sha256 === plan.file.sha256, "RUNTIME_CONTENT_CHANGED");
  for (const row of plan.rows) {
    const output = await destination(context, row.logicalKey, resourceBlocks(context, source, row));
    requireMolebox(output.sizeBytes === row.sizeBytes); files.push(output);
  }
  await verifySource(source, plan.file.sha256, context.signal);
  const audit = {file: plan.file.logicalKey, sourceSHA256: plan.file.sha256, format: plan.format, ...plan.evidence,
    extractedFiles: plan.rows.length, verifiedBlocks: plan.rows.reduce((sum, row) => sum + row.blocks.length, 0),
    overrides: plan.overrides, nativeCodeExecuted: false};
  const auditName = createHash("sha256").update(plan.file.logicalKey).digest("hex");
  await mkdir(context.auditRoot, {recursive: true});
  await writeFile(join(context.auditRoot, "molebox-" + auditName + ".json"), JSON.stringify(audit, null, 2));
  return {files, summary: {archiveCount: 1, verifiedEntries: plan.rows.length, details: []}};
}

export const molebox4 = Object.freeze({id: "molebox4-steelbox", version: 1, phase: "container", priority: 100,
  platforms: ["kirikiri"], formats: ["molebox4-steelbox"], probe, convert});

