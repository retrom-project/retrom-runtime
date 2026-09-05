// @vitest-environment node

import {execFileSync} from "node:child_process";
import {mkdtemp, readFile, rm, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {
  createProviderBuildMetadata,
  pinProviderReleaseMetadata,
  sourceTreeSha256,
} from "../scripts/provider-release.mjs";

const providers = [provider("emulatorjs", "1.0.0"), provider("retrom-runtime", "0.12.0")];

describe("Provider candidate and formal release identity", () => {
  it("uses the same working-tree identity implementation for the PFB candidate", async () => {
    const candidate = await readFile(new URL("../scripts/build-candidate.mjs", import.meta.url), "utf8");
    expect(candidate).toContain('import {sourceTreeSha256} from "./provider-release.mjs";');
    expect(candidate).toContain("sourceTreeSha256: sourceTreeSha256(root)");
    expect(candidate).not.toContain("function sourceTree()");
  });

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

  it("hashes the working source tree while excluding tracked files deleted by the change", async () => {
    const repository = await mkdtemp(join(tmpdir(), "provider-source-tree-"));
    try {
      execFileSync("git", ["init", "--quiet"], {cwd: repository});
      await writeFile(join(repository, "kept.txt"), "kept\n");
      await writeFile(join(repository, "retired.txt"), "retired\n");
      execFileSync("git", ["add", "kept.txt", "retired.txt"], {cwd: repository});
      await unlink(join(repository, "retired.txt"));
      const deletedTree = sourceTreeSha256(repository);
      expect(deletedTree).toMatch(/^[0-9a-f]{64}$/u);
      execFileSync("git", ["rm", "--cached", "retired.txt"], {cwd: repository});
      expect(sourceTreeSha256(repository)).toEqual(deletedTree);
      await writeFile(join(repository, "added.txt"), "new source\n");
      expect(sourceTreeSha256(repository)).not.toEqual(deletedTree);
    } finally {
      await rm(repository, {force: true, recursive: true});
    }
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
