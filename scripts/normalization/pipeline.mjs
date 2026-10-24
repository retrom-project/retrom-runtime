import {createHash} from "node:crypto";
import {lstat, realpath} from "node:fs/promises";
import {join} from "node:path";
import {contentHash} from "../../dist/runtime/index.js";
import {contentStream} from "../runtime-host-content.mjs";
import {safePath} from "../runtime-archive-input.mjs";

const maximumFile = 8 * 1024 ** 3, maximumTree = 64 * 1024 ** 3;
const compare = (a, b) => Buffer.from(a).compare(Buffer.from(b));
const code = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/u.test(value);
function requireValue(value, error = "RUNTIME_NORMALIZATION_OUTPUT_INVALID") {if (!value) {throw new Error(error);}}

function registry(plugins, platformId) {
  const ids = new Set();
  for (const plugin of plugins) {
    requireValue(code(plugin.id) && !ids.has(plugin.id) && Number.isSafeInteger(plugin.version) && plugin.version > 0 &&
      Number.isSafeInteger(plugin.priority) && Array.isArray(plugin.platforms) && plugin.platforms.every(code) &&
      Array.isArray(plugin.formats) && plugin.formats.length && plugin.formats.every(code) &&
      typeof plugin.probe === "function" && typeof plugin.convert === "function", "RUNTIME_NORMALIZATION_REGISTRY_INVALID");
    ids.add(plugin.id);
  }
  return [...plugins].filter(plugin => plugin.platforms.includes(platformId))
    .sort((a, b) => a.priority - b.priority || compare(a.id, b.id));
}

/** Read-only planning covers the whole game before any conversion starts.
 * Overlapping claims are a deterministic error, including equal priorities.
 * A matched plugin's exception is never interpreted as an unmatched result.
 */
export async function planNormalization(context, plugins) {
  const plans = [], claimed = new Set(), files = new Set(context.files.map(file => file.logicalKey));
  for (const plugin of registry(plugins, context.platformId)) {
    context.signal?.throwIfAborted();
    const matches = await plugin.probe(context);
    requireValue(Array.isArray(matches), "RUNTIME_NORMALIZATION_PLAN_INVALID");
    for (const plan of matches) {
      requireValue(plugin.formats.includes(plan.format) && Array.isArray(plan.claims) && plan.claims.length &&
        new Set(plan.claims).size === plan.claims.length && plan.claims.every(key => files.has(key)), "RUNTIME_NORMALIZATION_PLAN_INVALID");
      requireValue(Array.isArray(plan.outputs) && plan.outputs.length && plan.outputs.every(safePath) &&
        new Set(plan.outputs).size === plan.outputs.length, "RUNTIME_NORMALIZATION_PLAN_INVALID");
      if (plan.claims.some(key => claimed.has(key))) {throw new Error("RUNTIME_NORMALIZATION_CONFLICT");}
      for (const key of plan.claims) {claimed.add(key);}
      plans.push({plugin, plan});
    }
  }
  const targets = new Set([...files].filter(key => !claimed.has(key)));
  for (const {plan} of plans) {
    for (const key of plan.outputs) {
      if (targets.has(key)) {throw new Error("RUNTIME_NORMALIZATION_CONFLICT");}
      targets.add(key);
    }
  }
  return plans;
}

async function validateFiles(files, root, signal) {
  requireValue(Array.isArray(files) && files.length > 0 && files.length <= 100000);
  const seen = new Set();
  for (const file of files) {
    signal?.throwIfAborted();
    requireValue(safePath(file.logicalKey) && !seen.has(file.logicalKey) && file.path === join(root, file.logicalKey) &&
      Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0 && file.sizeBytes <= maximumFile && /^[a-f\d]{64}$/u.test(file.sha256));
    seen.add(file.logicalKey);
    const info = await lstat(file.path);
    requireValue(info.isFile() && info.size === file.sizeBytes && await realpath(file.path) === file.path);
    let size = 0; const hash = createHash("sha256");
    for await (const bytes of contentStream({path: file.path, offset: 0, sizeBytes: file.sizeBytes}, {signal})) {
      size += bytes.length; hash.update(bytes);
    }
    requireValue(size === file.sizeBytes && hash.digest("hex") === file.sha256);
  }
}

function receipt(plugin, plan, result, source) {
  const fact = file => ({file: file.logicalKey, sizeBytes: file.sizeBytes, sha256: file.sha256});
  return {id: plugin.id, version: plugin.version, formats: [plan.format],
    sources: source.filter(file => plan.claims.includes(file.logicalKey)).map(fact), outputs: result.files.map(fact),
    validation: {outputFilesVerified: result.files.length, resourceEntriesVerified: result.summary?.verifiedEntries ?? 0,
      metadataCorrections: result.summary?.metadataCorrections ?? 0, omittedPhysicalEntries: result.summary?.omittedPhysicalEntries ?? 0}};
}

/** Plugins write resources; the caller alone owns STORE packaging and publication. */
export async function runNormalization(input, plugins, signal) {
  const files = [...input.files].sort((a, b) => compare(a.logicalKey, b.logicalKey));
  requireValue(new Set(files.map(file => file.logicalKey)).size === files.length && files.every(file => safePath(file.logicalKey)),
    "RUNTIME_NORMALIZATION_INPUT_INVALID");
  const context = {platformId: input.platformId, files, locators: input.locators,
    sourceContentHash: contentHash(files, "TREE"), signal, cache: new Map()};
  const plans = await planNormalization(context, plugins);
  if (!plans.length) {return {files: input.files};}
  const changed = new Set(plans.flatMap(({plan}) => plan.claims)), retained = files.filter(file => !changed.has(file.logicalKey));
  const occupied = new Set(retained.map(file => file.logicalKey)), outputs = [], summary = {
    kind: "CONTENT_NORMALIZATION", converterVersion: 1, sourceContentHash: context.sourceContentHash,
    archiveCount: 0, verifiedEntries: 0, metadataCorrections: 0, omittedPhysicalEntries: 0,
    formatCounts: {}, warnings: [], details: [], plugins: [],
  };
  for (const {plugin, plan} of plans) {
    signal?.throwIfAborted();
    const result = await plugin.convert({...context, outputRoot: input.outputRoot}, plan);
    await validateFiles(result.files, input.outputRoot, signal);
    requireValue(result.files.length === plan.outputs.length && result.files.every(file => plan.outputs.includes(file.logicalKey)));
    for (const file of result.files) {
      if (occupied.has(file.logicalKey)) {throw new Error("RUNTIME_NORMALIZATION_CONFLICT");}
      occupied.add(file.logicalKey); outputs.push(file);
    }
    const current = receipt(plugin, plan, result, files), previous = summary.plugins.find(item => item.id === plugin.id);
    if (previous) {
      previous.formats = [...new Set([...previous.formats, ...current.formats])].sort(compare);
      previous.sources.push(...current.sources); previous.outputs.push(...current.outputs);
      for (const key of Object.keys(previous.validation)) {previous.validation[key] += current.validation[key];}
    } else {summary.plugins.push(current);}
    for (const key of ["archiveCount", "verifiedEntries", "metadataCorrections", "omittedPhysicalEntries"]) {summary[key] += result.summary?.[key] ?? 0;}
    summary.formatCounts[plan.format] = (summary.formatCounts[plan.format] ?? 0) + (result.summary?.archiveCount ?? 1);
    for (const warning of result.summary?.warnings ?? []) {
      const previousWarning = summary.warnings.find(item => item.code === warning.code);
      if (previousWarning) {previousWarning.count += warning.count;} else {summary.warnings.push({...warning});}
    }
    summary.details.push(...(result.summary?.details ?? []));
    requireValue(summary.details.length <= 2048 && Buffer.byteLength(JSON.stringify(summary)) <= 4 * 1024 * 1024, "RUNTIME_NORMALIZATION_AUDIT_LIMIT");
  }
  const result = [...retained, ...outputs].sort((a, b) => compare(a.logicalKey, b.logicalKey));
  requireValue(result.length <= 100000 && result.reduce((sum, file) => sum + file.sizeBytes, 0) <= maximumTree);
  return {files: result, normalization: summary};
}
