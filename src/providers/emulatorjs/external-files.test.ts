import {afterEach, describe, expect, it, vi} from "vitest";

import {installExternalFileCompatibility} from "./external-files.js";
import {installEmulatorJsRetroArchConfig} from "./retroarch-config.js";
import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";

afterEach(() => {Reflect.deleteProperty(window, "EJS_GameManager");});

describe("EmulatorJS external files", () => {
  it("preserves restore configuration and raw files when startup hooks share the deferred constructor", async () => {
    const cleanupConfig = installEmulatorJsRetroArchConfig(window, "flycast");
    const cleanupState = installEmulatorJs423StateRestoreCompatibility(window);
    const cleanupFiles = installExternalFileCompatibility(window, async write => {write("/parent.zip", Uint8Array.of(1, 2, 3));});
    const writeFile = vi.fn();
    const callMain = vi.fn();
    class Manager {
      Module = {callMain};
      getRetroArchCfg() {return "video_vsync = true\n";}
      writeFile(path: string, value: unknown) {writeFile(path, value);}
      async loadExternalFiles() {throw new Error("upstream extraction");}
    }
    const originalWrite = Manager.prototype.writeFile;
    try {
      Reflect.set(window, "EJS_GameManager", Manager);
      const manager = new Manager();
      await manager.loadExternalFiles();
      expect(writeFile).toHaveBeenCalledWith("/parent.zip", Uint8Array.of(1, 2, 3));
      expect(manager.getRetroArchCfg()).toContain("log_verbosity = true");
      manager.Module.callMain(["game.chd"]);
      expect(callMain).toHaveBeenCalledWith(["-v", "game.chd"]);
      manager.writeFile("/system/dc/dc_boot.bin", Uint8Array.of(1, 2, 3).buffer);
      expect(writeFile).toHaveBeenCalledWith("/system/dc/dc_boot.bin", Uint8Array.of(1, 2, 3));
      expect(Reflect.get(manager, "loadExplicitStateAndWait")).toBeTypeOf("function");
    } finally {
      cleanupFiles();
      cleanupState();
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

it("mounts verified external bytes before core start without either upstream ZIP extractor", async () => {
  const bytes = Uint8Array.of(0x50, 0x4b, 3, 4, 1, 2), writeFile = vi.fn(), upstream = vi.fn();
  const mount = vi.fn(async (write: (path: string, bytes: Uint8Array) => unknown) => {write("/base.zip", bytes);});
  const cleanup = installExternalFileCompatibility(window, mount);
  class Manager {
    writeFile(path: string, value: unknown) {writeFile(path, value);}
    async loadExternalFiles() {upstream();}
  }
  const original = Manager.prototype.loadExternalFiles;
  Reflect.set(window, "EJS_GameManager", Manager);
  await new Manager().loadExternalFiles();
  expect(upstream).not.toHaveBeenCalled();
  expect(writeFile).toHaveBeenCalledExactlyOnceWith("/base.zip", bytes);
  cleanup();
  expect(Manager.prototype.loadExternalFiles).toBe(original);
});
