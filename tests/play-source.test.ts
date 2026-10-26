import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

it("pins the published Play ABI-v3 core and its verified assets", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect(sources.developmentInputs.some((source: {id: string}) => source.id === "play")).toBe(false);
  const play = sources.upstreamReleases.find((entry: {id: string}) => entry.id === "play");
  expect(play).toMatchObject({
    repository: "https://github.com/retrom-project/Play-",
    upstreamCommit: "83700b2c31e593bc94e845b4b31b797be84dda59",
    adapterAbi: "play-host-v3",
    tag: "retrom-core-g83700b2c31e5-r5",
    commit: "c129ec30ce25f78740f252283e0bf61098ec6002",
  });
  expect(play.metadataUrl).toBe(`${play.repository}/releases/download/${play.tag}/rpg-runtime-release.json`);
  expect(play.assets.map((asset: {filename: string}) => asset.filename).sort()).toEqual([
    "LICENSE", "Play.js", "Play.wasm", "checkpoint.mjs", "disc-device.mjs", "input.mjs", "play-retrom.mjs",
  ]);
  for (const asset of play.assets) {
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.url).toBe(`${play.repository}/releases/download/${play.tag}/${asset.filename}`);
  }
});
