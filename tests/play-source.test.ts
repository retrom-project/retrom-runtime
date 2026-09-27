import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {assertScummvmCandidateMode} from "../scripts/scummvm-release.mjs";
it("requires a verified Play ABI-v3 candidate until the new core release is published", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect(sources.upstreamReleases.some((source: {id: string}) => source.id === "play")).toBe(false);
  const play = sources.developmentInputs.find((entry: {id: string}) => entry.id === "play");
  expect(play.repository).toBe("https://github.com/retrom-project/Play-");
  expect(play).not.toHaveProperty("tag");
  expect(() => assertScummvmCandidateMode([play], true, true)).toThrow("UNPUBLISHED_CORE_INPUT");
  expect(play.upstreamCommit).toBe("83700b2c31e593bc94e845b4b31b797be84dda59");
  expect(play.adapterAbi).toBe("play-host-v3");
  expect(play.assets.map((asset: {filename: string}) => asset.filename).sort()).toEqual([
    "LICENSE", "Play.js", "Play.wasm", "checkpoint.mjs", "disc-device.mjs", "input.mjs", "play-retrom.mjs",
  ]);
});
