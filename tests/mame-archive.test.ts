// @vitest-environment node
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {zipSync} from "fflate";
import {expect, it} from "vitest";
import {sha256} from "../scripts/provider-sources.mjs";
import {stagePinnedCoreRelease, validMameRelease} from "../scripts/pinned-core-release.mjs";

it("extracts one pinned MAME archive and rejects corruption before staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "mame-archive-")), stage = pathToFileURL(root + "/");
  const payloads = {"LICENSES.txt": new Uint8Array([1, 2]),
    "mame-apple.wasm": new Uint8Array([0, 97, 115, 109]),
    "mame-common.wasm": new Uint8Array([0, 97, 115, 109, 1])};
  const archive = zipSync(payloads);
  const repository = "https://github.com/retrom-project/mame";
  const tag = "retrom-core-gf65d5ba9bc42-r2";
  const assets = Object.entries(payloads).map(([filename, bytes]) => ({filename,
    output: filename === "LICENSES.txt" ? "licenses/mame/LICENSES.txt" : `runtime/mame/${filename}`, maxSizeBytes: 1024,
    sizeBytes: bytes.length, sha256: sha256(bytes)}));
  const release = {id: "mame", repository, tag, commit: "a".repeat(40),
    adapterAbi: "retrom-mame-dylink-v1",
    metadataUrl: `${repository}/releases/download/${tag}/rpg-runtime-release.json`,
    archive: {filename: "mame-current-assets.zip", format: "zip",
      url: `${repository}/releases/download/${tag}/mame-current-assets.zip`,
      sizeBytes: archive.length, sha256: sha256(archive)}, assets};
  const metadata = {schemaVersion: 1, repository, tag, commit: release.commit,
    adapterAbi: release.adapterAbi, archive: {filename: release.archive.filename,
      format: "zip", sizeBytes: archive.length, sha256: sha256(archive),
      files: assets.map(asset => asset.filename)},
    files: assets.map(({filename, sizeBytes, sha256: hash}) => ({filename, sizeBytes, sha256: hash}))};
  expect(validMameRelease(release)).toBe(true);
  try {
    await expect(stagePinnedCoreRelease(release, {...metadata, archive: {...metadata.archive, files: []}},
      async () => archive, stage)).rejects.toThrow("PINNED_CORE_METADATA_INVALID");
    await expect(stagePinnedCoreRelease(release, metadata,
      async () => new Uint8Array(archive.length), stage)).rejects.toThrow("PINNED_CORE_ARCHIVE_INVALID");
    expect(await readdir(root)).toEqual([]);
    await stagePinnedCoreRelease(release, metadata, async () => archive, stage);
    for (const asset of assets) {
      expect(new Uint8Array(await readFile(join(root, asset.output)))).toEqual(payloads[asset.filename as keyof typeof payloads]);
    }
  } finally {await rm(root, {recursive: true, force: true});}
});
