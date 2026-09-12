import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {expect, it} from "vitest";
import {sha256} from "../scripts/provider-sources.mjs";
import {stagePinnedCoreIfNeeded, stagePinnedCoreRelease} from "../scripts/pinned-core-release.mjs";
it("rejects metadata and downloaded byte changes before publishing any asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinned-core-")), stage = pathToFileURL(root + "/");
  const bytes = new Uint8Array([1, 2, 3]);
  const asset = {filename: "core.wasm", output: "runtime/core.wasm", url: "https://example.com/core.wasm",
    maxSizeBytes: 16, sizeBytes: bytes.length, sha256: sha256(bytes)};
  const release = {repository: "https://example.com/core", tag: "r1", commit: "a".repeat(40), adapterAbi: "core-v1", assets: [asset]};
  const metadata = {...release, schemaVersion: 1, files: [{filename: asset.filename, sizeBytes: asset.sizeBytes, sha256: asset.sha256}]};
  try {
    await expect(stagePinnedCoreRelease(release, {...metadata, commit: "b".repeat(40)}, async () => bytes, stage)).rejects.toThrow("PINNED_CORE_METADATA_INVALID");
    await expect(stagePinnedCoreRelease(release, metadata, async () => new Uint8Array([3, 2, 1]), stage)).rejects.toThrow("PINNED_CORE_ASSET_INVALID");
    expect(await readdir(root)).toEqual([]);
    await stagePinnedCoreRelease(release, metadata, async () => bytes, stage);
    expect(new Uint8Array(await readFile(join(root, asset.output)))).toEqual(bytes);
  } finally {await rm(root, {recursive: true, force: true});}
});

it.each(["nxengine", "ppsspp"])("verifies %s download bytes before the release build publishes assets", async id => {
  const root = await mkdtemp(join(tmpdir(), "pinned-route-")), stage = pathToFileURL(root + "/");
  const bytes = new Uint8Array([1, 2, 3]);
  const asset = {filename: "core.wasm", output: "runtime/core.wasm", url: "https://example.com/core.wasm",
    maxSizeBytes: 16, sizeBytes: bytes.length, sha256: sha256(bytes)};
  const release = {id, repository: "https://example.com/core", tag: "r1", commit: "a".repeat(40), adapterAbi: "core-v1", assets: [asset]};
  const metadata = {...release, schemaVersion: 1, files: [{filename: asset.filename, sizeBytes: asset.sizeBytes, sha256: asset.sha256}]};
  try {
    await expect(stagePinnedCoreIfNeeded(release, metadata, async () => new Uint8Array([3, 2, 1]), stage)).rejects.toThrow("PINNED_CORE_ASSET_INVALID");
    await expect(stagePinnedCoreIfNeeded(release, {...metadata, files: []}, async () => bytes, stage)).rejects.toThrow("PINNED_CORE_METADATA_INVALID");
    expect(await readdir(root)).toEqual([]);
    expect(await stagePinnedCoreIfNeeded(release, metadata, async () => bytes, stage)).toBe(true);
    expect(new Uint8Array(await readFile(join(root, asset.output)))).toEqual(bytes);
  } finally {await rm(root, {recursive: true, force: true});}
});
