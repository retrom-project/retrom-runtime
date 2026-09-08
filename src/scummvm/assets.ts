import {scummvmJson} from "./json.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import {saveDigest} from "./checkpoint.js";
import {blockSize, ScummvmFiles, type BlockCache} from "./files.js";

type Asset = {path: string; sizeBytes: number; sha256: string};
export type CoreManifest = {schemaVersion: 1; adapterAbi: string; upstreamCommit: string;
  engines: Record<string, string>; files: Asset[]};

export async function coreAssets(base: string, engine: string, cache: BlockCache | null,
  signal: AbortSignal, report: RuntimeProgressReporter) {
  const manifest = await scummvmJson(new URL("manifest.json", base).href, 1024 * 1024, signal, "SCUMMVM_CORE_MANIFEST_INVALID");
  if (!validManifest(manifest)) {throw invalid();}
  const plugin = manifest.engines[engine];
  if (!plugin) {throw new Error("SCUMMVM_ENGINE_UNAVAILABLE");}
  const digest = await saveDigest(new TextEncoder().encode(JSON.stringify(manifest)));
  const index = (files: Asset[], strip: string) => ({schemaVersion: 1,
    files: files.map((entry) => ({...entry, path: entry.path.slice(strip.length), url: new URL(entry.path, base).href}))});
  const all = new ScummvmFiles(index(manifest.files, ""), digest, fetch, cache, signal);
  const data = new ScummvmFiles(index(manifest.files.filter((entry) => entry.path.startsWith("data/")), "data/"),
    digest, fetch, cache, signal, "/data");
  const needed = ["scummvm.wasm", plugin].map((path) => manifest.files.find((entry) => entry.path === path));
  if (needed.some((entry) => !entry || entry.sizeBytes <= 0 || entry.sizeBytes > 128 * 1024 * 1024)) {throw invalid();}
  const totalBytes = needed.reduce((total, entry) => total + entry!.sizeBytes, 0);
  let loadedBytes = 0;
  const read = async (entry: Asset) => {
    const result = new Uint8Array(entry.sizeBytes);
    for (let start = 0; start < entry.sizeBytes; start += blockSize) {
      const bytes = await all.read(`/game/${entry.path}`, start, Math.min(blockSize, entry.sizeBytes - start));
      result.set(bytes, start); loadedBytes += bytes.length;
      report({phase: "RUNTIME_ASSET", loadedBytes, totalBytes});
    }
    if (await saveDigest(result) !== entry.sha256) {throw new Error("SCUMMVM_ASSET_DIGEST_MISMATCH");}
    return result;
  };
  report({phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes});
  return {data, plugin, wasm: await read(needed[0]!), pluginBytes: await read(needed[1]!)};
}

function validManifest(value: unknown): value is CoreManifest {
  if (!value || typeof value !== "object") {return false;}
  const manifest = value as CoreManifest;
  if (manifest.schemaVersion !== 1 || manifest.adapterAbi !== "scummvm-host-v1" ||
    !/^[0-9a-f]{40}$/u.test(manifest.upstreamCommit) || !manifest.engines || typeof manifest.engines !== "object" ||
    !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 4096) {return false;}
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || paths.has(file.path) ||
      !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || !/^[0-9a-f]{64}$/u.test(file.sha256)) {return false;}
    paths.add(file.path);
  }
  return Object.entries(manifest.engines).every(([engine, path]) => /^[a-z0-9_]+$/u.test(engine) &&
    path === `plugins/lib${engine}.so` && paths.has(path));
}
function invalid() {return new Error("SCUMMVM_CORE_MANIFEST_INVALID");}
