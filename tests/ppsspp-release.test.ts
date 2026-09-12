// @vitest-environment node
import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

it("requires the complete immutable PSP release before accepting formal sources", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  const release = sources.upstreamReleases.find((entry: {id: string}) => entry.id === "ppsspp");
  expect(release).toMatchObject({repository: "https://github.com/retrom-project/ppsspp",
    tag: "retrom-core-g2e6fd06ed6c7-r2", commit: "fe5a19d2d1d619869b064e72a73e835519bb2ed2", adapterAbi: "ppsspp-host-v2"});
  expect(release.assets.map((asset: {filename: string}) => asset.filename).sort()).toEqual([
    "LICENSE", "ppsspp-host.mjs", "ppsspp-io.worker.mjs", "ppsspp.data", "ppsspp.js", "ppsspp.wasm", "ppsspp.worker.mjs",
  ]);
  expect(sources.developmentInputs?.some((entry: {id: string}) => entry.id === "ppsspp") ?? false).toBe(false);
  expect(() => validateProviderSources(sources)).not.toThrow();
  const original = release.assets[0].sha256;
  release.assets[0].sha256 = "missing";
  expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
  release.assets[0].sha256 = original;
  release.assets[0].sizeBytes = release.assets[0].maxSizeBytes + 1;
  expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
});
