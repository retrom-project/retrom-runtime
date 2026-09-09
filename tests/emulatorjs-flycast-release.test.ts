// @vitest-environment node
import {expect, it} from "vitest";
import {forkMetadataPath, forkReleaseFiles, verifyForkMetadata} from "../scripts/emulatorjs-fork-releases.mjs";
import {emulatorJsCoreInputs} from "../scripts/emulatorjs-core-candidate.mjs";

it("binds Flycast release bytes and metadata separately and confines candidate overrides", () => {
  const repository = "https://github.com/retrom-project/flycast-wasm", tag = "retrom-core-1.0-r1";
  const assets = ["LICENSE", "flycast-wasm.data", "flycast.json", "rpg-runtime-release.json"].map((filename) => ({
    filename, sha256: "a".repeat(64), sizeBytes: 100, url: `${repository}/releases/download/${tag}/${filename}`,
  }));
  const fork = {repository, tag, commit: "b".repeat(40), adapterAbi: "emulatorjs-flycast-state-v1",
    runtimeCore: "flycast", assets};
  const metadata = {schemaVersion: 1, repository, tag, commit: fork.commit, adapterAbi: fork.adapterAbi,
    files: assets.filter((file) => file.filename !== "rpg-runtime-release.json")};
  expect(forkReleaseFiles({forks: [fork]}).map((file) => file.destination)).toContain("4.2.3/data/cores/reports/flycast.json");
  expect(forkMetadataPath(fork)).toBe("4.2.3/data/cores/reports/flycast-release.json");
  expect(() => verifyForkMetadata(fork, metadata)).not.toThrow();
  expect(() => verifyForkMetadata(fork, {...metadata, commit: "c".repeat(40)})).toThrow("EMULATORJS_FORK_RELEASE_INVALID");
  expect(() => verifyForkMetadata(fork, {...metadata, files: [metadata.files[0], metadata.files[0], metadata.files[2]]}))
    .toThrow("EMULATORJS_FORK_RELEASE_INVALID");
  expect(() => verifyForkMetadata(fork, {...metadata, files: metadata.files.map((file) => ({...file, sha256: "d".repeat(64)}))}))
    .toThrow("EMULATORJS_FORK_RELEASE_INVALID");
  expect(() => forkReleaseFiles({forks: [{...fork, adapterAbi: "emulatorjs-state-v1"}]})).toThrow();
  const input = emulatorJsCoreInputs({forks: [fork]}, {flycast: "/candidate/flycast"}, true);
  expect(input.forks).toEqual([]);
  expect(input.developmentCores[0]?.files).toHaveLength(3);
  expect(input.developmentCores[0]?.files.map((file) => file.filename)).not.toContain("rpg-runtime-release.json");
  expect(() => emulatorJsCoreInputs({forks: [fork]}, {flycast: "/candidate/flycast"}, false)).toThrow("UNPUBLISHED_CORE_INPUT");
  expect(emulatorJsCoreInputs({forks: [fork]}).forks).toEqual([fork]);
});
