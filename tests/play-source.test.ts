import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
it("pins Play through a published ABI-v2 release", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect(sources.developmentInputs?.some((source: {id: string}) => source.id === "play") ?? false).toBe(false);
  const play = sources.upstreamReleases.find((entry: {id: string}) => entry.id === "play");
  expect(play.repository).toBe("https://github.com/retrom-project/Play-");
  expect(play.tag).toBe("retrom-core-g83700b2c31e5-r3");
  expect(play.commit).toMatch(/^[0-9a-f]{40}$/u);
  expect(play.upstreamCommit).toBe("83700b2c31e593bc94e845b4b31b797be84dda59");
  expect(play.adapterAbi).toBe("play-host-v2");
  expect(play.assets.map((asset: {filename: string}) => asset.filename).sort()).toEqual([
    "LICENSE", "Play.js", "Play.wasm", "checkpoint.mjs", "disc-device.mjs", "input.mjs", "play-retrom.mjs",
  ]);
});
