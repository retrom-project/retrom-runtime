import {access, readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

describe("Provider source authority boundary", () => {
  it("keeps upstream acquisition separate from the Provider target declaration", async () => {
    await expect(access("runtime-manifest.json")).rejects.toMatchObject({code: "ENOENT"});
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8")) as Record<string, unknown>;
    expect(Object.keys(sources).sort()).toEqual([
      "developmentInputs", "localAssets", "packageName", "publicApiVersion", "schemaVersion", "upstreamReleases",
    ]);
    expect(sources).not.toHaveProperty("adapters");
    expect(sources).not.toHaveProperty("cores");
  });
  it("admits bounded core, font, license and corresponding-source closures", () => {
    const repository = "https://github.com/retrom-project/core-fixture";
    const tag = "retrom-core-g000000000000-r1";
    const release = {id: "fixture", repository, tag, commit: "a".repeat(40),
      adapterAbi: "fixture-v1", metadataUrl: `${repository}/releases/download/${tag}/rpg-runtime-release.json`,
      assets: Array.from({length: 13}, (_, index) => ({filename: `asset-${index}.bin`,
        output: `runtime/fixture/asset-${index}.bin`, maxSizeBytes: 1024,
        url: `${repository}/releases/download/${tag}/asset-${index}.bin`}))};
    const sources = {schemaVersion: 1, publicApiVersion: 2, packageName: "@xxxsen/retrom-runtime",
      localAssets: [], upstreamReleases: [release]};
    const assets = release.assets;
    for (const length of [9, 12]) {
      release.assets = assets.slice(0, length);
      expect(() => validateProviderSources(sources)).not.toThrow();
    }
    for (const length of [0, 1, 13]) {
      release.assets = assets.slice(0, length);
      expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
    }
  });
});
