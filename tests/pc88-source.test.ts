// @vitest-environment node
import {describe, expect, it} from "vitest";
import {validEmulatorJsDevelopmentSource} from "../scripts/emulatorjs-development-forks.mjs";
describe("PC-88 source admission", () => {
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
