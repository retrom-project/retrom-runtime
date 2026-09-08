import {describe, expect, it} from "vitest";
import {installEmulatorJsRetroArchConfig} from "./retroarch-config.js";

describe("EmulatorJS RetroArch configuration", () => {
  it("selects the Fuse Kempston port before construction and restores the prototype", () => {
    class Manager {getRetroArchCfg() {return "video_vsync = true\n";}}
    const original = Manager.prototype.getRetroArchCfg;
    const cleanup = installEmulatorJsRetroArchConfig(window, "fuse", false);
    Reflect.set(window, "EJS_GameManager", Manager);
    expect(new Manager().getRetroArchCfg()).toContain('input_libretro_device_p1 = "513"');
    expect(new Manager().getRetroArchCfg()).toContain('input_libretro_device_p2 = "0"');
    expect(new Manager().getRetroArchCfg()).toContain("video_vsync = true");
    cleanup();
    expect(Manager.prototype.getRetroArchCfg).toBe(original);
    expect(Reflect.has(window, "EJS_GameManager")).toBe(false);
  });

  it("enables native restore observation without changing other core devices", () => {
    class Manager {getRetroArchCfg() {return "";}}
    const cleanup = installEmulatorJsRetroArchConfig(window, "vice_x64sc", true);
    Reflect.set(window, "EJS_GameManager", Manager);
    expect(new Manager().getRetroArchCfg()).toBe("\nlog_verbosity = true\n");
    cleanup();
  });

  it("leaves ordinary launches untouched", () => {
    const cleanup = installEmulatorJsRetroArchConfig(window, "fceumm", false);
    expect(Reflect.has(window, "EJS_GameManager")).toBe(false);
    cleanup();
  });
});
