import {afterEach, describe, expect, it, vi} from "vitest";

import {installExternalFileCompatibility} from "./external-files.js";
import {installEmulatorJsRetroArchConfig} from "./retroarch-config.js";
import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";

afterEach(() => {Reflect.deleteProperty(window, "EJS_GameManager");});

describe("EmulatorJS external files", () => {
  it("preserves restore configuration when BIOS and state hooks share the deferred constructor", () => {
    const cleanupConfig = installEmulatorJsRetroArchConfig(window, "flycast", true);
    const cleanupFiles = installExternalFileCompatibility(window);
    const cleanupState = installEmulatorJs423StateRestoreCompatibility(window);
    const writeFile = vi.fn();
    class Manager {
      getRetroArchCfg() {return "video_vsync = true\n";}
      writeFile(path: string, value: unknown) {writeFile(path, value);}
    }
    const originalWrite = Manager.prototype.writeFile;
    try {
      Reflect.set(window, "EJS_GameManager", Manager);
      const manager = new Manager();
      expect(manager.getRetroArchCfg()).toContain("log_verbosity = true");
      manager.writeFile("/system/dc/dc_boot.bin", Uint8Array.of(1, 2, 3).buffer);
      expect(writeFile).toHaveBeenCalledWith("/system/dc/dc_boot.bin", Uint8Array.of(1, 2, 3));
      expect(Reflect.get(manager, "loadExplicitStateAndWait")).toBeTypeOf("function");
    } finally {
      cleanupState();
      cleanupFiles();
      cleanupConfig();
    }
    expect(new Manager().getRetroArchCfg()).toBe("video_vsync = true\n");
    expect(Manager.prototype.writeFile).toBe(originalWrite);
    expect(Reflect.has(Manager.prototype, "loadExplicitStateAndWait")).toBe(false);
  });

  it("normalizes cross-realm ArrayBuffer writes and restores the constructor boundary", () => {
    const cleanup = installExternalFileCompatibility(window);
    const writeFile = vi.fn();
    class Manager {writeFile(path: string, value: unknown) {return writeFile(path, value);}}
    Reflect.set(window, "EJS_GameManager", Manager);
    const manager = new Manager() as Manager & {writeFile: (path: string, value: ArrayBuffer) => void};
    manager.writeFile("/disc.chd", Uint8Array.of(1, 2, 3).buffer);
    expect(writeFile).toHaveBeenCalledWith("/disc.chd", Uint8Array.of(1, 2, 3));
    cleanup();
    expect(Reflect.has(window, "EJS_GameManager")).toBe(false);
  });
});
