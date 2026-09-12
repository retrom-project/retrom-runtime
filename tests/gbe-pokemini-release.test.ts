// @vitest-environment node
import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

it("requires pinned Pokémon Mini sizes and hashes before accepting formal sources", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  const release = sources.upstreamReleases.find((entry: {id: string}) => entry.id === "gbe_plus");
  expect(release).toMatchObject({repository: "https://github.com/retrom-project/gbe-plus",
    tag: "retrom-core-g05a05e931b39-r1", adapterAbi: "gbe-pokemini-host-v1"});
  expect(sources.developmentInputs?.some((entry: {id: string}) => entry.id === "gbe_plus") ?? false).toBe(false);
  expect(() => validateProviderSources(sources)).not.toThrow();
  const original = release.assets[0].sha256;
  release.assets[0].sha256 = "missing";
  expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
  release.assets[0].sha256 = original;
  release.assets[0].sizeBytes = release.assets[0].maxSizeBytes + 1;
  expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
});
