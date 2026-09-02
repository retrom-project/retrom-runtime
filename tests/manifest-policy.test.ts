import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../scripts/manifest.mjs";

describe("upstream fork release policy", () => {
  it("declares a stable game line and explicit save read contract for every core", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));

    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.publicApiVersion).toBe(2);
    for (const core of manifest.cores) {
      expect(core.gameCompatibilityLine).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u);
      expect(core.saveAbi).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u);
      expect(core.readableSaveAbis).toContain(core.saveAbi);
      expect(new Set(core.readableSaveAbis).size).toBe(core.readableSaveAbis.length);
    }
  });

  it("declares one generic capability and checkpoint descriptor for every adapter", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));

    expect(manifest.adapters).toHaveLength(8);
    for (const adapter of manifest.adapters) {
      expect(adapter.checkpointFormat).toMatch(/^[a-z0-9][a-z0-9.-]{0,63}$/u);
      expect(adapter.capabilities).toMatchObject({checkpoint: true, standardGamepad: true});
    }
  });

  it("rejects a core whose adapter identity drifts from the public descriptor", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    manifest.cores[0].adapterAbi = "drifted-adapter";

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects in-repository third-party core builds", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    manifest.sourceBuilds = [];

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects a runtime that cannot read the saves it writes", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    manifest.cores[0].readableSaveAbis = ["different-save-v1"];

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects an unversioned game compatibility line", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    manifest.cores[0].gameCompatibilityLine = "rpgmaker-2000";

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects the retired retrom-web tag namespace", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    const release = manifest.upstreamReleases[0];
    release.tag = "retrom-web-0.8.1.1-r9";
    release.metadataUrl = `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json`;
    for (const asset of release.assets) {
      asset.url = `${release.repository}/releases/download/${release.tag}/${asset.filename}`;
    }

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects the retired rpg-runtime tag namespace", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    const release = manifest.upstreamReleases[0];
    release.tag = "rpg-runtime-0.8.1.1-r9";
    release.metadataUrl = `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json`;
    for (const asset of release.assets) {
      asset.url = `${release.repository}/releases/download/${release.tag}/${asset.filename}`;
    }

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects a fork outside the Retrom organization", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    const release = manifest.upstreamReleases[0];
    release.repository = "https://github.com/another-owner/Player";
    release.metadataUrl = `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json`;
    for (const asset of release.assets) {
      asset.url = `${release.repository}/releases/download/${release.tag}/${asset.filename}`;
    }

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });

  it("rejects metadata outside the pinned fork release", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    manifest.upstreamReleases[0].metadataUrl =
      "https://github.com/retrom-project/Player/releases/download/latest/rpg-runtime-release.json";

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });
});
