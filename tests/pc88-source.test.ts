// @vitest-environment node
import {describe, expect, it} from "vitest";
import {validEmulatorJsDevelopmentSource} from "../scripts/emulatorjs-development-forks.mjs";
import {forkReleaseFiles} from "../scripts/emulatorjs-fork-releases.mjs";
describe("PC-88 source admission", () => {
  it("admits immutable fork releases while rejecting other repositories and tag families", () => {
    const repository = "https://github.com/retrom-project/quasi88-libretro";
    const tag = "retrom-core-g459bbc6e90ca-r1";
    const fork = {repository, tag, commit: "a".repeat(40), adapterAbi: "emulatorjs-state-v1", runtimeCore: "quasi88",
      assets: ["quasi88-wasm.data", "LICENSE", "source.tar.gz", "rpg-runtime-release.json"].map(filename => ({
        filename, sizeBytes: 1, sha256: "b".repeat(64), url: `${repository}/releases/download/${tag}/${filename}`,
      }))};
    expect(forkReleaseFiles({forks: [fork]})).toHaveLength(4);
    for (const changed of [{repository: "https://github.com/libretro/quasi88-libretro"},
      {tag: "latest"}, {adapterAbi: "unknown"}]) {
      expect(() => forkReleaseFiles({forks: [{...fork, ...changed}]})).toThrow("EMULATORJS_FORK_RELEASE_INVALID");
    }
  });
  it("accepts only the selected fork, upstream commit and ABI", () => {
    const source = {id: "quasi88", repository: "https://github.com/retrom-project/quasi88-libretro",
      upstreamCommit: "459bbc6e90caa3dc392ae8e64a9b0881b1e5ef77", adapterAbi: "emulatorjs-state-v1"};
    expect(validEmulatorJsDevelopmentSource(source)).toBe(true);
    for (const altered of [{repository: "https://github.com/libretro/quasi88-libretro"},
      {upstreamCommit: "a".repeat(40)}, {adapterAbi: "unknown"}]) {
      expect(validEmulatorJsDevelopmentSource({...source, ...altered})).toBe(false);
    }
  });
});
