import {unzipSync} from "fflate";
import {safePath, sha256} from "./provider-sources.mjs";

export function validScummvmSource(value) {
  return exactKeys(value, ["id", "repository", "upstreamCommit", "adapterAbi", "archive"]) &&
    value.id === "scummvm" && value.repository === "https://github.com/retrom-project/scummvm" &&
    /^[0-9a-f]{40}$/u.test(value.upstreamCommit) && value.adapterAbi === "scummvm-host-v1" &&
    validArchive(value.archive);
}
function validArchive(value) {
  return exactKeys(value, ["filename", "maxSizeBytes", "maxUnpackedSizeBytes", "layout"]) &&
    value.filename === "scummvm-runtime.zip" && value.layout === "src/scummvm/core-layout.json" &&
    positiveBound(value.maxSizeBytes, 256 * 1024 * 1024) && positiveBound(value.maxUnpackedSizeBytes, 768 * 1024 * 1024);
}
export function assertScummvmCandidateMode(inputs, pfb, formal) {
  if (inputs.length && (!pfb || formal)) {throw new Error("UNPUBLISHED_CORE_INPUT");}
}
export function validateScummvmLayout(layout) {
  if (!exactKeys(layout, ["schemaVersion", "engines", "files"]) || layout.schemaVersion !== 1 ||
    !Array.isArray(layout.engines) || !layout.engines.length || layout.engines.length > 256 ||
    !Array.isArray(layout.files) || !layout.files.length || layout.files.length > 4096) {throw invalid();}
  const engines = new Set();
  for (const engine of layout.engines) {
    if (typeof engine !== "string" || !/^[a-z0-9_]+$/u.test(engine) || engines.has(engine)) {throw invalid();}
    engines.add(engine);
  }
  const paths = new Map();
  let previous = "";
  for (const file of layout.files) {
    if (!exactKeys(file, ["path", "maxSizeBytes"]) || !safeEntry(file.path) || file.path <= previous ||
      !positiveBound(file.maxSizeBytes, 128 * 1024 * 1024)) {throw invalid();}
    previous = file.path; paths.set(file.path, file.maxSizeBytes);
  }
  const required = ["scummvm.mjs", "scummvm-retrom.mjs", "scummvm.wasm", "manifest.json",
    "licenses/COPYING", "native/linux-x86_64/scummvm-detector", ...[...engines].map((engine) => `plugins/lib${engine}.so`)];
  if (required.some((path) => !paths.has(path)) ||
    [...paths.keys()].filter((path) => path.startsWith("plugins/")).length !== engines.size) {throw invalid();}
  return paths;
}
export function unpackScummvmCandidate(source, layout, bytes) {
  if (!validScummvmSource(source) || !bytes.length || bytes.length > source.archive.maxSizeBytes) {throw invalid();}
  const expected = validateScummvmLayout(layout);
  const seen = new Set(); let total = 0;
  let files;
  try {
    files = unzipSync(bytes, {filter(entry) {
      const maximum = expected.get(entry.name);
      total += entry.originalSize;
      if (!maximum || seen.has(entry.name) || entry.originalSize < 1 || entry.originalSize > maximum ||
        total > source.archive.maxUnpackedSizeBytes) {throw invalid();}
      seen.add(entry.name); return true;
    }});
  } catch {throw invalid();}
  if (seen.size !== expected.size) {throw invalid();}
  for (const [path, contents] of Object.entries(files)) {
    if (!contents.length || contents.length > expected.get(path)) {throw invalid();}
  }
  verifyManifest(source, layout, files);
  return new Map(Object.entries(files));
}
function verifyManifest(source, layout, files) {
  if (files["manifest.json"].length > 1024 * 1024) {throw invalid();}
  let manifest;
  try {manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(files["manifest.json"]));} catch {throw invalid();}
  if (!exactKeys(manifest, ["schemaVersion", "adapterAbi", "upstreamCommit", "engines", "files"]) ||
    manifest.schemaVersion !== 1 || manifest.adapterAbi !== source.adapterAbi || manifest.upstreamCommit !== source.upstreamCommit ||
    !manifest.engines || typeof manifest.engines !== "object" || !Array.isArray(manifest.files) ||
    manifest.files.length !== layout.files.length - 1) {throw invalid();}
  const expectedEngines = Object.fromEntries(layout.engines.map((engine) => [engine, `plugins/lib${engine}.so`]));
  if (JSON.stringify(Object.entries(manifest.engines).sort()) !== JSON.stringify(Object.entries(expectedEngines).sort())) {throw invalid();}
  const seen = new Set();
  for (const file of manifest.files) {
    if (!exactKeys(file, ["path", "sizeBytes", "sha256"]) || !safeEntry(file.path) || seen.has(file.path) ||
      file.path === "manifest.json") {throw invalid();}
    const content = files[file.path];
    if (!content || content.length !== file.sizeBytes || sha256(content) !== file.sha256) {throw invalid();}
    seen.add(file.path);
  }
}
export function scummvmOutput(path) {
  return path.startsWith("licenses/") ? `licenses/scummvm/${path.slice(9)}` : `runtime/scummvm/${path}`;
}
function safeEntry(value) {return safePath(value) && !value.includes("\\") && [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);}
function positiveBound(value, maximum) {return Number.isSafeInteger(value) && value > 0 && value <= maximum;}
function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function invalid() {return new Error("SCUMMVM_ARCHIVE_INVALID");}
