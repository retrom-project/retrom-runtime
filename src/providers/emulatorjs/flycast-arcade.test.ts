import {describe, expect, it} from "vitest";
import {flycastContentName, emulatorJsDisableCue} from "./disc-mount.js";

describe("Flycast arcade content naming", () => {
  it("keeps the machine name and ZIP extension for arcade targets", () => {
    for (const target of ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"]) {
      expect(flycastContentName("/content/game/pstone2.zip", "a".repeat(64), target)).toBe("pstone2.zip");
    }
  });
  it("keeps the existing Dreamcast CHD identity", () => {
    expect(flycastContentName("/content/game/game.chd", "b".repeat(64), "flycast"))
      .toBe(`${"b".repeat(64)}.chd`);
  });
  it("rejects misleading names and unsupported targets", () => {
    expect(() => flycastContentName("/content/game/game.chd", "a".repeat(64), "flycast-naomi")).toThrow();
    expect(() => flycastContentName("/content/game/../pstone2.zip", "a".repeat(64), "flycast-naomi")).toThrow();
    expect(() => flycastContentName("/content/game/pstone2.zip", "a".repeat(64), "unknown")).toThrow();
  });
  it("keeps Flycast cartridge ZIPs instead of making a synthetic CD cue", () => {
    for (const target of ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"]) {
      expect(emulatorJsDisableCue("flycast", target)).toBe(true);
    }
    expect(emulatorJsDisableCue("flycast", "flycast")).toBe(false);
    expect(emulatorJsDisableCue("cap32", "cap32")).toBe(true);
    expect(emulatorJsDisableCue("quasi88", "quasi88")).toBe(true);
  });
});
