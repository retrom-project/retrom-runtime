import {describe, expect, it} from "vitest";
import {forkReleaseFiles, forkMetadataPath, verifyForkMetadata} from "../scripts/emulatorjs-fork-releases.mjs";

function fixture() {
  const repository = "https://github.com/retrom-project/vice-libretro";
  const tag = "retrom-core-g1b4309f4d56d-r1-rc.2";
  const assets = ["vice_xvic-wasm.data", "rpg-runtime-release.json", "COPYING"].map((filename) => ({
    filename, sha256: "b".repeat(64), sizeBytes: 12,
    url: `${repository}/releases/download/${tag}/${filename}`,
  }));
  return {runtimeCore: "vice_xvic", repository, tag, commit: "a".repeat(40), adapterAbi: "emulatorjs-state-v1", assets};
}

describe("EmulatorJS fork Release inputs", () => {
  it("maps only the declared archive, provenance report and license", () => {
    const files = forkReleaseFiles({forks: [fixture()]});
    expect(files.map((file: {destination: string}) => file.destination)).toEqual([
      "4.2.3/data/cores/vice_xvic-wasm.data",
      "4.2.3/data/cores/reports/vice_xvic.json",
      "4.2.3/licenses/forks/vice_xvic/COPYING",
    ]);
  });

  it("rejects floating sources, duplicate cores and unrecognized forks", () => {
    const fork = fixture();
    for (const changed of [{...fork, tag: "latest"}, {...fork, runtimeCore: "fuse"},
      {...fork, repository: "https://example.invalid/vice-libretro"},
      {...fork, assets: fork.assets.slice(1)}]) {
      expect(() => forkReleaseFiles({forks: [changed]})).toThrow("EMULATORJS_FORK_RELEASE_INVALID");
    }
    expect(() => forkReleaseFiles({forks: [fork, fork]})).toThrow("EMULATORJS_FORK_RELEASE_INVALID");
  });

  it("cross-checks the metadata commit and every asset hash", () => {
    const fork = fixture();
    const metadata = {...fork, schemaVersion: 1, assets: fork.assets.filter((asset) =>
      asset.filename !== "rpg-runtime-release.json").map((asset) => ({
      filename: asset.filename, observedSha256: asset.sha256, sizeBytes: asset.sizeBytes,
    }))};
    expect(() => verifyForkMetadata(fork, metadata)).not.toThrow();
    expect(() => verifyForkMetadata(fork, {...metadata, commit: "c".repeat(40)}))
      .toThrow("EMULATORJS_FORK_RELEASE_INVALID");
    expect(() => verifyForkMetadata(fork, {...metadata, assets: [{...metadata.assets[0], observedSha256: "d".repeat(64)}]}))
      .toThrow("EMULATORJS_FORK_RELEASE_INVALID");
  });
});

const promotedCores = [
  ["bsnes", "bsnes-libretro", "g4b344745e387", "LICENSE.txt"],
  ["vecx", "libretro-vecx", "g8f671cc9d737", "LICENSE.md"],
  ["81", "81-libretro", "g86decf3ee61e", "LICENSE"],
  ["cap32", "libretro-cap32", "g310cc579b79b", "COPYING"],
  ["crocods", "libretro-crocods", "gbe00fb904da0", "LICENSE"],
  ["same_cdi", "same_cdi", "gcfb05d803f54", "COPYING"],
  ["vice_xpet", "vice-libretro", "g1b4309f4d56d", "COPYING"],
  ["vice_xplus4", "vice-libretro", "g1b4309f4d56d", "COPYING"],
];
it.each(promotedCores)("verifies the published %s core, source archive and variant metadata", (core, repo, baseline, license) => {
  const repository = `https://github.com/retrom-project/${repo}`, tag = `retrom-core-${baseline}-r1`;
  const variant = core.startsWith("vice_");
  const report = variant ? `${core}-release.json` : "rpg-runtime-release.json";
  const source = variant ? `${core}-source.tar.gz` : "source.tar.gz";
  const assets = [`${core}-wasm.data`, license, source, report].map(filename => ({filename,
    sha256: "b".repeat(64), sizeBytes: 12, url: `${repository}/releases/download/${tag}/${filename}`}));
  const fork = {runtimeCore: core, repository, tag, commit: "a".repeat(40), adapterAbi: "emulatorjs-state-v1", assets};
  const metadata = {...fork, schemaVersion: 1, assets: assets.filter(a => a.filename !== report).map(a => ({
    filename: a.filename, observedSha256: a.sha256, sizeBytes: a.sizeBytes,
  }))};
  expect(forkMetadataPath(fork)).toBe(`${core === "bsnes" ? "4.3.0-pre" : "4.2.3"}/data/cores/reports/${core}.json`);
  expect(forkReleaseFiles({forks: [fork]}).map((f: {destination: string}) => f.destination))
    .toContain(`${core === "bsnes" ? "4.3.0-pre" : "4.2.3"}/licenses/forks/${core}/${source}`);
  expect(() => verifyForkMetadata(fork, metadata)).not.toThrow();
  expect(() => forkReleaseFiles({forks: [{...fork, assets: assets.filter(a => a.filename !== source)}]})).toThrow();
  expect(() => verifyForkMetadata(fork, {...metadata, assets: metadata.assets.slice(1)})).toThrow();
  expect(() => verifyForkMetadata(fork, {...metadata, assets: metadata.assets.map(a => a.filename === source ? {...a, observedSha256: "c".repeat(64)} : a)})).toThrow();
});
