import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
it("pins Play through normal published release assets without development inputs", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect((sources.developmentInputs ?? []).map((input: {id: string}) => input.id)).not.toContain("play");
  const play = sources.upstreamReleases.find((entry: {id: string}) => entry.id === "play");
  expect(play.repository).toBe("https://github.com/retrom-project/Play-");
  expect(play.tag).toMatch(/^retrom-core-g83700b2c31e5-r[1-9][0-9]*$/u);
  expect(play.adapterAbi).toBe("play-host-v1");
  expect(play.assets.map((asset: {filename: string}) => asset.filename).sort()).toEqual([
    "LICENSE", "Play.js", "Play.wasm", "checkpoint.mjs", "input.mjs", "play-retrom.mjs", "range-device.mjs",
  ]);
});
