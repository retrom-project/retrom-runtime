import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach, describe, expect, it} from "vitest";

import {buildProviderBundle, readDeterministicTarGz} from "../scripts/provider-bundle.mjs";
import {CHUNK_LIMIT_BYTES, chunkGroup, chunkProviderBundle, planProviderChunks, verifyProviderChunks}
  from "../scripts/provider-chunks.mjs";
import type {ProviderChunkManifest} from "../scripts/provider-chunks.mjs";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {force: true, recursive: true})));
});

const mib = 1024 * 1024;
const hex = (value: number) => createHash("sha256").update(String(value)).digest("hex");

describe("Provider chunk partition", () => {
  it("groups one directory per core, EmulatorJS cores by name and forks by license directory", () => {
    expect([
      "assets/mame/mame-common.wasm", "assets/scummvm/plugins/libscumm.so",
      "assets/4.2.3/data/cores/fbneo-wasm.data", "assets/4.2.3/data/cores/fbneo-arcade.dat",
      "assets/4.2.3/data/cores/mame2003_plus-wasm.data", "assets/4.2.3/data/emulator.min.js",
      "assets/4.3.0-pre/data/src/GameManager.js", "assets/content-io/worker.mjs",
      "licenses/emulatorjs/4.2.3/licenses/forks/ardens/source.tar.gz", "licenses/retrom-runtime/LICENSE",
      "client.mjs", "integrity.json",
    ].map(chunkGroup)).toEqual([
      "assets/mame", "assets/scummvm",
      "assets/4.2.3/data/cores/fbneo", "assets/4.2.3/data/cores/fbneo",
      "assets/4.2.3/data/cores/mame2003_plus", "assets/4.2.3",
      "assets/4.3.0-pre", "",
      "licenses/emulatorjs/4.2.3/licenses/forks/ardens", "licenses",
      "", "",
    ]);
  });

  it("splits a group above the size limit into path-hash buckets, never splitting a single file", () => {
    const plugins = Array.from({length: 40}, (_, index) =>
      ({path: `assets/big/plugins/lib${index}.so`, sizeBytes: 3 * mib, sha256: hex(index)}));
    const huge = {path: "assets/big/huge.wasm", sizeBytes: 80 * mib, sha256: "d".repeat(64)};
    const small = {path: "assets/small/core.wasm", sizeBytes: 2 * mib, sha256: "e".repeat(64)};
    const plan = planProviderChunks([...plugins, huge, small]);
    expect(CHUNK_LIMIT_BYTES).toBe(32 * mib);
    expect(plan.flatMap((chunk) => chunk.files.map((file) => file.path)).sort())
      .toEqual([...plugins, huge, small].map((file) => file.path).sort());
    expect(plan.find((chunk) => chunk.files.some((file) => file.path === huge.path))?.files).toHaveLength(1);
    expect(plan.find((chunk) => chunk.files.some((file) => file.path === small.path))?.files).toHaveLength(1);
    const buckets = plan.filter((chunk) => chunk.files[0].path.startsWith("assets/big/plugins/"));
    expect(buckets.every((chunk) => chunk.unpackedSizeBytes <= CHUNK_LIMIT_BYTES)).toBe(true);
    // 120 MiB of small files pack into a handful of chunks rather than one chunk per file.
    expect(buckets.length).toBeGreaterThanOrEqual(4);
    expect(buckets.length).toBeLessThanOrEqual(16);
  });

  it("changes only the touched bucket when one file of an oversized group changes, appears or goes", () => {
    const plugins = Array.from({length: 40}, (_, index) =>
      ({path: `assets/big/plugins/lib${index}.so`, sizeBytes: 3 * mib, sha256: hex(index)}));
    const ids = (files: typeof plugins) => new Set(planProviderChunks(files).map((chunk) => chunk.chunkId));
    const before = ids(plugins);
    const changed = ids(plugins.map((file, index) => index === 7 ? {...file, sha256: "f".repeat(64)} : file));
    const added = ids([...plugins, {path: "assets/big/plugins/new.so", sizeBytes: 1024, sha256: "f".repeat(64)}]);
    const removed = ids(plugins.filter((_, index) => index !== 7));
    for (const after of [changed, added, removed]) {
      expect([...after].filter((id) => !before.has(id))).toHaveLength(1);
      expect([...before].filter((id) => !after.has(id))).toHaveLength(1);
    }
  });

  it("derives the chunk identity only from paths, sizes and file hashes", () => {
    const files = [{path: "assets/core/b.wasm", sizeBytes: 2, sha256: "b".repeat(64)},
      {path: "assets/core/a.js", sizeBytes: 1, sha256: "a".repeat(64)}];
    const [first] = planProviderChunks(files);
    const [second] = planProviderChunks([...files].reverse());
    expect(first.chunkId).toBe(second.chunkId);
    const expected = createHash("sha256").update(JSON.stringify([
      ["assets/core/a.js", 1, "a".repeat(64)], ["assets/core/b.wasm", 2, "b".repeat(64)]])).digest("hex");
    expect(first.chunkId).toBe(expected);
    const [changed] = planProviderChunks([{...files[0], sha256: "c".repeat(64)}, files[1]]);
    expect(changed.chunkId).not.toBe(first.chunkId);
  });
});

describe("Provider chunk publication", () => {
  it("keeps unchanged cores byte-identical across versions and only changes the touched chunks", async () => {
    const root = await temporaryRoot();
    const first = await publish(root, "first", "0.1.0", {"assets/alpha/core.wasm": "alpha", "assets/beta/core.wasm": "beta"});
    const second = await publish(root, "second", "0.1.1", {"assets/alpha/core.wasm": "alpha", "assets/beta/core.wasm": "beta-2"});
    const byGroup = (result: Awaited<ReturnType<typeof publish>>) => new Map(result.manifest.chunks.map((chunk) =>
      [chunk.files[0].path.split("/").slice(0, 2).join("/"), chunk]));
    const [old, updated] = [byGroup(first), byGroup(second)];
    expect(updated.get("assets/alpha")).toEqual(old.get("assets/alpha"));
    expect(updated.get("assets/beta")?.chunkId).not.toBe(old.get("assets/beta")?.chunkId);
    expect(await readFile(join(second.chunkRoot, updated.get("assets/alpha")!.archive)))
      .toEqual(await readFile(join(first.chunkRoot, old.get("assets/alpha")!.archive)));
  });

  it("covers the bundle exactly once and identifies it by its integrity file", async () => {
    const root = await temporaryRoot();
    const result = await publish(root, "bundle", "0.1.0", {"assets/alpha/core.wasm": "alpha"});
    const integrity = await readFile(join(result.bundle.bundleRoot, "integrity.json"));
    expect(result.bundle.bundleSha256).toBe(createHash("sha256").update(integrity).digest("hex"));
    expect(result.manifest).toMatchObject({schemaVersion: 1, providerId: "fixture", providerVersion: "0.1.0",
      bundleSha256: result.bundle.bundleSha256});
    const paths = result.manifest.chunks.flatMap((chunk) => chunk.files.map((file) => file.path)).sort();
    expect(paths).toEqual(["LICENSE", "assets/alpha/core.wasm", "client.mjs", "integrity.json", "provenance.json", "provider.json"]);
    for (const chunk of result.manifest.chunks) {
      const entries = readDeterministicTarGz(await readFile(join(result.chunkRoot, chunk.archive)));
      expect(entries.map(([path]) => path)).toEqual(chunk.files.map((file) => file.path));
    }
    await expect(verifyProviderChunks({bundleRoot: result.bundle.bundleRoot, manifestPath: result.manifestPath,
      chunkRoot: result.chunkRoot})).resolves.toMatchObject({chunkCount: result.manifest.chunks.length, fileCount: 6});
  });

  it("rejects a tampered chunk archive, a missing file and an extra file", async () => {
    const root = await temporaryRoot();
    const result = await publish(root, "bundle", "0.1.0", {"assets/alpha/core.wasm": "alpha", "assets/beta/core.wasm": "beta"});
    const verify = () => verifyProviderChunks({bundleRoot: result.bundle.bundleRoot, manifestPath: result.manifestPath,
      chunkRoot: result.chunkRoot});
    const target = result.manifest.chunks.find((chunk) => chunk.files[0].path === "assets/beta/core.wasm")!;
    const archive = join(result.chunkRoot, target.archive);
    const original = await readFile(archive);
    await writeFile(archive, Buffer.concat([original, Buffer.from([0])]));
    await expect(verify()).rejects.toThrow("PROVIDER_CHUNKS_INVALID");
    await writeFile(archive, original);
    const dropped = {...result.manifest, chunks: result.manifest.chunks.filter((chunk) => chunk !== target)};
    await writeFile(result.manifestPath, JSON.stringify(dropped));
    await expect(verify()).rejects.toThrow("PROVIDER_CHUNKS_INVALID");
    const duplicated = {...result.manifest, chunks: [...result.manifest.chunks, target]};
    await writeFile(result.manifestPath, JSON.stringify(duplicated));
    await expect(verify()).rejects.toThrow("PROVIDER_CHUNKS_INVALID");
  });

  it("publishes only content-addressed chunk archives and one manifest per Provider", async () => {
    const root = await temporaryRoot();
    const result = await publish(root, "bundle", "0.1.0", {"assets/alpha/core.wasm": "alpha"});
    const names = (await readdir(result.chunkRoot)).sort();
    expect(names).toContain("fixture-chunks-0.1.0.json");
    expect(names.filter((name) => name !== "fixture-chunks-0.1.0.json")
      .every((name) => /^fixture-chunk-[0-9a-f]{64}\.tar\.gz$/u.test(name))).toBe(true);
    expect(names.length).toBe(result.manifest.chunks.length + 1);
  });
});

async function publish(root: string, name: string, version: string, assets: Record<string, string>) {
  const source = join(root, name, "source");
  await mkdir(source, {recursive: true});
  const assetSources = new Map<string, string>();
  for (const [path, contents] of Object.entries(assets)) {
    const file = join(source, path.replaceAll("/", "_"));
    await writeFile(file, contents);
    assetSources.set(path, file);
  }
  const license = join(source, "LICENSE");
  await writeFile(license, "fixture license\n");
  const bundle = await buildProviderBundle({
    assetSources,
    bundleRoot: join(root, name, "bundle"),
    clientModuleBytes: new TextEncoder().encode("export default {};\n"),
    licenseSources: new Map([["LICENSE", license]]),
    manifest: {schemaVersion: 1, providerId: "fixture", providerVersion: version, providerApiVersion: 1,
      clientModulePath: "client.mjs", targets: [{assetPaths: Object.keys(assets)}]},
    provenance: {schemaVersion: 1},
  });
  const chunkRoot = join(root, name, "chunks");
  const published = await chunkProviderBundle({bundleRoot: bundle.bundleRoot, providerId: "fixture",
    providerVersion: version, outputRoot: chunkRoot});
  const manifest = JSON.parse(await readFile(published.manifestPath, "utf8")) as ProviderChunkManifest;
  return {bundle, chunkRoot, manifest, manifestPath: published.manifestPath};
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "provider-chunks-"));
  temporaryRoots.push(root);
  return root;
}
