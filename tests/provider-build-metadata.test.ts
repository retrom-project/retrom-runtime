// @vitest-environment node

import {describe, expect, it} from "vitest";

import {createProviderBuildMetadata, pinProviderReleaseMetadata} from "../scripts/provider-release.mjs";

const providers = [provider("emulatorjs", "1.0.0"), provider("retrom-runtime", "0.12.0")];

describe("Provider candidate and formal release identity", () => {
  it("keeps candidate metadata free of invented release identity", () => {
    const metadata = createProviderBuildMetadata(providers, "a".repeat(64));
    expect(Object.keys(metadata).sort()).toEqual(["providers", "schemaVersion", "sourceTreeSha256"]);
    expect(JSON.stringify(metadata)).not.toMatch(/\b(?:commit|repository|tag)\b/u);
    expect(metadata.providers.map((entry) => entry.providerId)).toEqual(["emulatorjs", "retrom-runtime"]);
  });

  it("pins formal metadata only to the exact package tag and immutable commit", () => {
    const build = createProviderBuildMetadata(providers, "a".repeat(64));
    const release = pinProviderReleaseMetadata(build, {
      commit: "b".repeat(40), repository: "https://github.com/retrom-project/retrom-runtime", tag: "v0.12.0",
    }, "0.12.0");
    expect(release.release).toEqual({
      commit: "b".repeat(40), repository: "https://github.com/retrom-project/retrom-runtime", tag: "v0.12.0",
    });
    expect(release.providers).toEqual(build.providers);
    expect(() => pinProviderReleaseMetadata(build, {
      commit: "b".repeat(40), repository: "https://github.com/retrom-project/retrom-runtime", tag: "v0.11.2",
    }, "0.12.0")).toThrow("PROVIDER_RELEASE_INVALID");
    expect(() => pinProviderReleaseMetadata(build, {
      commit: "HEAD", repository: "https://github.com/retrom-project/retrom-runtime", tag: "v0.12.0",
    }, "0.12.0")).toThrow("PROVIDER_RELEASE_INVALID");
  });
});

function provider(providerId: string, providerVersion: string) {
  return {
    archive: `${providerId}/${providerId}-provider-${providerVersion}.tar.gz`,
    bundleDirectory: `${providerId}/${providerId}-${providerVersion}`,
    bundleSha256: "c".repeat(64), bundleSizeBytes: 100, fileCount: 6,
    manifestSha256: "d".repeat(64), providerId, providerVersion, unpackedSizeBytes: 200,
  };
}
