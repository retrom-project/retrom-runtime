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

it("verifies separately declared corresponding source before publishing the complete closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinned-source-")), stage = pathToFileURL(root + "/");
  const bytes = new Uint8Array([4, 5, 6]);
  const file = {filename: "core.wasm", output: "runtime/fixture/core.wasm", url: "https://example.com/core.wasm",
    maxSizeBytes: 16, sizeBytes: bytes.length, sha256: sha256(bytes)};
  const source = {...file, filename: "source.tar.gz", output: "licenses/fixture/source.tar.gz", url: "https://example.com/source.tar.gz"};
  const release = {repository: "https://example.com/fixture", tag: "r1", commit: "a".repeat(40), adapterAbi: "fixture-v1", assets: [file, source]};
  const record = ({filename, sizeBytes, sha256}: typeof file) => ({filename, sizeBytes, sha256});
  const metadata = {...release, schemaVersion: 1, files: [record(file)], sourceArchive: record(source)};
  try {
    await expect(stagePinnedCoreRelease(release, {...metadata, sourceArchive: undefined}, async () => bytes, stage)).rejects.toThrow("PINNED_CORE_METADATA_INVALID");
    await expect(stagePinnedCoreRelease(release, {...metadata, sourceArchive: {...record(source), sha256: "b".repeat(64)}}, async () => bytes, stage)).rejects.toThrow("PINNED_CORE_METADATA_INVALID");
    await expect(stagePinnedCoreRelease(release, metadata, async url => url === source.url ? new Uint8Array([6, 5, 4]) : bytes, stage)).rejects.toThrow("PINNED_CORE_ASSET_INVALID");
    expect(await readdir(root)).toEqual([]);
    await stagePinnedCoreRelease(release, metadata, async () => bytes, stage);
    expect(new Uint8Array(await readFile(join(root, source.output)))).toEqual(bytes);
    await stagePinnedCoreRelease(release, {...metadata, files: [record(file), record(source)]}, async () => bytes, stage);
    await expect(stagePinnedCoreRelease(release, {...metadata, files: [record(file), {...record(source), sizeBytes: 2}]}, async () => bytes, stage)).rejects.toThrow("PINNED_CORE_METADATA_INVALID");
    await stagePinnedCoreRelease({...release, assets: [file]}, metadata, async url => {
      expect(url).toBe(file.url);
      return bytes;
    }, stage);
  } finally {await rm(root, {recursive: true, force: true});}
});

it.each(["nxengine", "ppsspp", "siglus", "ethornell"])("verifies %s download bytes before the release build publishes assets", async id => {
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
