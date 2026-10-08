// @vitest-environment node
import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

it("pins the published MAME Current release and validates every family asset", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect(sources.developmentInputs.some((source: {id: string}) => source.id === "mame")).toBe(false);
  const mame = sources.upstreamReleases.find((source: {id: string}) => source.id === "mame");
  expect(mame).toMatchObject({
    repository: "https://github.com/retrom-project/mame",
    tag: "retrom-core-gf65d5ba9bc42-r3",
    commit: "11288494f6e4cc2334155223ec5575cb486aa242",
    adapterAbi: "retrom-mame-dylink-v1",
  });
  expect(mame.metadataUrl).toBe(`${mame.repository}/releases/download/${mame.tag}/rpg-runtime-release.json`);
  expect(mame.archive).toMatchObject({filename: "mame-current-assets.zip", format: "zip", sizeBytes: 33349625,
    sha256: "100d760a3d10d2de84ea5a802161aac8aa297ba414a019deda3ccc7771d77b5d"});
  expect(mame.assets).toHaveLength(94);
  for (const asset of mame.assets) {
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.sizeBytes).toBeLessThanOrEqual(asset.maxSizeBytes);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(asset.url).toBeUndefined();
  }
  expect(mame.assets.map((asset: {filename: string}) => asset.filename)).toContain("mame-common.wasm");
  expect(mame.assets.map((asset: {filename: string}) => asset.filename)).toContain("mame-arcade_model2.wasm");
  const invalid = structuredClone(sources);
  invalid.upstreamReleases.find((source: {id: string}) => source.id === "mame").assets[0].sizeBytes = 0;
  expect(() => validateProviderSources(invalid)).toThrow("PROVIDER_SOURCES_INVALID");
});
