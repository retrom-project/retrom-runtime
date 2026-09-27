// @vitest-environment node
import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

it("[PK-06] CONTRACT/PSP pins the published ABI-v4 core and verified assets", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect(sources.developmentInputs.some((source: {id: string}) => source.id === "ppsspp")).toBe(false);
  const psp = sources.upstreamReleases.find((entry: {id: string}) => entry.id === "ppsspp");
  expect(psp).toMatchObject({
    repository: "https://github.com/retrom-project/ppsspp",
    upstreamCommit: "2e6fd06ed6c77db467dea5fb3f67abd93457da20",
    adapterAbi: "ppsspp-host-v4",
    tag: "retrom-core-g2e6fd06ed6c7-r4",
    commit: "0107382fc31ce958da09d4ec4a9f9e3047803aae",
  });
  expect(psp.metadataUrl).toBe(`${psp.repository}/releases/download/${psp.tag}/rpg-runtime-release.json`);
  expect(psp.assets.map((asset: {filename: string}) => asset.filename).sort()).toEqual([
    "LICENSE", "ppsspp-host.mjs", "ppsspp.data", "ppsspp.js", "ppsspp.wasm", "ppsspp.worker.mjs",
  ]);
  for (const asset of psp.assets) {
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.url).toBe(`${psp.repository}/releases/download/${psp.tag}/${asset.filename}`);
  }
  const invalid = structuredClone(sources);
  invalid.upstreamReleases.find((entry: {id: string}) => entry.id === "ppsspp").assets[0].maxSizeBytes = 0;
  expect(() => validateProviderSources(invalid)).toThrow("PROVIDER_SOURCES_INVALID");
});
