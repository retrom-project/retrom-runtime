import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {materializeFileBytes} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {ScummvmFiles} from "./files.js";
type Asset = {path: string; sizeBytes: number; sha256: string};
export type CoreManifest = {schemaVersion: 1; adapterAbi: string; upstreamCommit: string;
  engines: Record<string, string>; files: Asset[]};
export async function coreAssets(base: string, engine: string, content: AdapterContentOptions,
  signal: AbortSignal, report: RuntimeProgressReporter) {
  const manifestIdentity = content.assetIndex["assets/scummvm/manifest.json"];
  if (!manifestIdentity) {throw invalid();}
  const raw = await materializeFileBytes(content.contentSession, {...manifestIdentity, url: new URL("manifest.json", base).href},
    eagerPolicy(1024 * 1024), "CORE_ASSET", signal);
  let manifest: unknown;
  try {manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw));} catch {throw invalid();}
  if (!validManifest(manifest)) {throw invalid();}
  // A self-consistent but foreign manifest cannot authorize executable or lazy data URLs.
  for (const file of manifest.files.filter(file => !file.path.startsWith("licenses/"))) {
    const trusted = content.assetIndex[`assets/scummvm/${file.path}`];
    if (!trusted || trusted.sizeBytes !== file.sizeBytes || trusted.sha256 !== file.sha256) {throw invalid();}
  }
  const plugin = manifest.engines[engine]; if (!plugin) {throw new Error("SCUMMVM_ENGINE_UNAVAILABLE");}
  const needed = ["scummvm.wasm", plugin].map(path => manifest.files.find(file => file.path === path));
  if (needed.some(file => !file || file.sizeBytes <= 0 || file.sizeBytes > 128 * 1024 * 1024)) {throw invalid();}
  const totalBytes = needed.reduce((total, file) => total + file!.sizeBytes, 0); let loadedBytes = 0;
  const read = async (entry: Asset) => {
    const bytes = await materializeFileBytes(content.contentSession, {...entry, url: new URL(entry.path, base).href},
      eagerPolicy(128 * 1024 * 1024), "CORE_ASSET", signal,
      progress => report({phase: "RUNTIME_ASSET", loadedBytes: loadedBytes + progress.readyBytes, totalBytes}));
    loadedBytes += bytes.length; return bytes;
  };
  report({phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes});
  const wasm = await read(needed[0]!), pluginBytes = await read(needed[1]!);
  const dataFiles = manifest.files.filter(file => file.path.startsWith("data/"));
  const data = new ScummvmFiles({schemaVersion: 1, files: dataFiles.map(entry => ({...entry,
    path: entry.path.slice(5), url: new URL(entry.path, base).href}))}, manifestIdentity.sha256, content.contentSession, signal,
  "/data", new Map(dataFiles.map(file => [file.path.slice(5), file.sha256])));
  return {data, plugin, wasm, pluginBytes};
}

function validManifest(value: unknown): value is CoreManifest {
  if (!value || typeof value !== "object") {return false;}
  const manifest = value as CoreManifest;
  if (manifest.schemaVersion !== 1 || manifest.adapterAbi !== "scummvm-host-v1" ||
    !/^[0-9a-f]{40}$/u.test(manifest.upstreamCommit) || !manifest.engines || typeof manifest.engines !== "object" ||
    !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 4096) {return false;}
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!validAsset(file) || paths.has(file.path)) {return false;}
    paths.add(file.path);
  }
  return Object.entries(manifest.engines).every(([engine, path]) => /^[a-z0-9_]+$/u.test(engine) &&
    path === `plugins/lib${engine}.so` && paths.has(path));
}
function invalid() {return new Error("SCUMMVM_CORE_MANIFEST_INVALID");}

function validAsset(file: Asset) {
  return file && typeof file.path === "string" && safePath(file.path) && Number.isSafeInteger(file.sizeBytes) &&
    file.sizeBytes >= 0 && /^[0-9a-f]{64}$/u.test(file.sha256);
}
function safePath(path: string) {
  return !/[\\?#%]/u.test(path) && [...path].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
    path.split("/").every(part => Boolean(part) && part !== "." && part !== "..");
}
