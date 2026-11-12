import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {openContent, contentStream} from "../runtime-host-content.mjs";
import {requireLocator, safePath} from "../runtime-archive-input.mjs";
import {requireMolebox, readMoleboxAt, decodeMolebox, inflateMoleboxBlock, moleboxCRC16} from "./molebox-codec.mjs";
import {inspectMolebox} from "./molebox-vfs.mjs";
import {normalizationDestination as destination, verifyNormalizationSource as verifySource} from "./output.mjs";

const folded = value => value.toUpperCase();
const rootOf = file => file.logicalKey.slice(0, file.logicalKey.lastIndexOf("/") + 1);
async function namespaceView(context, plan) {
  const source = requireLocator(context, plan.file), entries = new Map();
  await verifySource(source, plan.file.sha256, context.signal);
  for (const row of plan.rows) {
    const hash = createHash("sha256");
    for await (const bytes of resourceBlocks(context, source, row)) {hash.update(bytes);}
    entries.set(row.hash, {flags: row.flags, name: row.name, sha256: hash.digest("hex")});
  }
  await verifySource(source, plan.file.sha256, context.signal);
  return {plan, entries, root: folded(rootOf(plan.file))};
}
function covers(outer, inner) {
  if (outer.root !== inner.root || outer.entries.size < inner.entries.size) {return false;}
  let executable = false;
  for (const [hash, row] of inner.entries) {
    const other = outer.entries.get(hash);
    if (!other || other.flags !== row.flags || other.name !== row.name || other.sha256 !== row.sha256) {return false;}
    executable ||= Boolean(row.flags & 0x10);
  }
  return executable;
}
async function selectNamespaces(context, plans) {
  if (plans.length < 2) {return plans;}
  const views = [];
  for (const plan of plans) {views.push(await namespaceView(context, plan));}
  // A shared executable and byte-identical inherited resources prove the same
  // launch environment. Mere row counts, names or package sizes do not.
  const selected = views.filter(view => !views.some(other => other !== view && covers(other, view) &&
    (other.entries.size > view.entries.size || Buffer.from(other.plan.file.logicalKey).compare(Buffer.from(view.plan.file.logicalKey)) < 0)));
  for (const view of selected) {
    const aliases = views.filter(other => other !== view && covers(view, other)).map(other => other.plan.file.logicalKey);
    if (aliases.length) {view.plan.evidence.coalescedLaunchers = aliases;}
  }
  return selected.map(view => view.plan);
}
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
    const privateRoot = prefix + ".retrom-molebox/" + createHash("sha256").update(file.logicalKey).digest("hex") + "/";
    const rows = index.rows.map(row => {
      const self = row.name !== null && folded(prefix + row.name) === folded(file.logicalKey);
      const target = row.name === null || self ? privateRoot + row.hash + (row.flags & 0x10 ? ".exe" : ".bin") : prefix + row.name;
      requireMolebox(safePath(target), "RUNTIME_MOLEBOX_PATH_INVALID");
      const previous = existing.get(folded(target));
      requireMolebox(!target.startsWith(privateRoot) || !previous, "RUNTIME_NORMALIZATION_CONFLICT");
      // The supported node flags have neither native physical-file fallback
      // bit. Their paths shadow the external file in this executable's domain.
      if (previous) {overrides.push(previous);}
      return {...row, logicalKey: previous ?? target};
    });
    const namespace = rows.some(row => row.logicalKey.startsWith(privateRoot)) ? {
      path: privateRoot + "index.json", kind: "molebox4-steelbox", source: file.logicalKey,
      entries: rows.map(row => ({hash: row.hash, flags: row.flags, path: row.logicalKey})),
      directories: [...new Set(rows.map(row => row.directory).filter(Boolean))],
    } : null;
    if (namespace) {requireMolebox(!context.files.some(item => folded(item.logicalKey).startsWith(folded(prefix + ".retrom-molebox/"))),
      "RUNTIME_NORMALIZATION_CONFLICT");}
    const outputs = [file.logicalKey, ...rows.map(row => row.logicalKey), ...(namespace ? [namespace.path] : [])];
    requireMolebox(new Set(outputs.map(folded)).size === outputs.length, "RUNTIME_NORMALIZATION_CONFLICT");
    plans.push({format: "molebox4-steelbox", claims: [file.logicalKey], outputs, overrides,
      launchDomain: file.logicalKey, file, rows, namespace, evidence: index.evidence});
  }
  return selectNamespaces(context, plans);
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
  if (plan.namespace) {
    const {path, ...value} = plan.namespace;
    files.push(await destination(context, path, [Buffer.from(JSON.stringify(value))]));
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

