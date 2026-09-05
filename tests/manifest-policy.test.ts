import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";

describe("upstream fork release policy", () => {
  it("rejects in-repository third-party core builds", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    sources.sourceBuilds = [];
    expect(() => validateProviderSources(sources)).toThrowError("PROVIDER_SOURCES_INVALID");
  });

  it("rejects the retired retrom-web tag namespace", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    const release = sources.upstreamReleases[0];
    release.tag = "retrom-web-0.8.1.1-r9";
    release.metadataUrl = `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json`;
    for (const asset of release.assets) {
      asset.url = `${release.repository}/releases/download/${release.tag}/${asset.filename}`;
    }

    expect(() => validateProviderSources(sources)).toThrowError("PROVIDER_SOURCES_INVALID");
  });

  it("rejects the retired rpg-runtime tag namespace", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    const release = sources.upstreamReleases[0];
    release.tag = "rpg-runtime-0.8.1.1-r9";
    release.metadataUrl = `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json`;
    for (const asset of release.assets) {
      asset.url = `${release.repository}/releases/download/${release.tag}/${asset.filename}`;
    }

    expect(() => validateProviderSources(sources)).toThrowError("PROVIDER_SOURCES_INVALID");
  });

  it("rejects a fork outside the Retrom organization", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    const release = sources.upstreamReleases[0];
    release.repository = "https://github.com/another-owner/Player";
    release.metadataUrl = `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json`;
    for (const asset of release.assets) {
      asset.url = `${release.repository}/releases/download/${release.tag}/${asset.filename}`;
    }

    expect(() => validateProviderSources(sources)).toThrowError("PROVIDER_SOURCES_INVALID");
  });

  it("rejects metadata outside the pinned fork release", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    sources.upstreamReleases[0].metadataUrl =
      "https://github.com/retrom-project/Player/releases/download/latest/rpg-runtime-release.json";

    expect(() => validateProviderSources(sources)).toThrowError("PROVIDER_SOURCES_INVALID");
  });
});
