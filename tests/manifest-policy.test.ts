import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../scripts/manifest.mjs";

describe("upstream fork release policy", () => {
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

  it("rejects metadata outside the pinned fork release", async () => {
    const manifest = JSON.parse(await readFile("runtime-manifest.json", "utf8"));
    manifest.upstreamReleases[0].metadataUrl =
      "https://github.com/xxxsen/Player/releases/download/latest/rpg-runtime-release.json";

    expect(() => validateManifest(manifest)).toThrowError("RUNTIME_MANIFEST_INVALID");
  });
});
