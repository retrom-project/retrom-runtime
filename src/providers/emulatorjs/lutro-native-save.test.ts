import {describe, expect, it} from "vitest";
import {captureLutroNativeSave, importLutroNativeSave, installLutroNativeRestore, LutroNativeSaveTracker} from "./lutro-native-save.js";
import type {EjsInstance} from "./emulator-instance.js";

function memoryFs() {
  const files = new Map<string, Uint8Array>();
  const directories = new Set(["/", "/data", "/data/saves"]);
  return {
    files,
    analyzePath: (path: string) => ({exists: directories.has(path) || files.has(path)}),
    mkdir: (path: string) => {directories.add(path);},
    readdir: (path: string) => [".", "..", ...new Set([...files.keys(), ...directories].filter(p => p.startsWith(`${path}/`))
      .map(p => p.slice(path.length + 1).split("/")[0]).filter(Boolean))],
    readFile: (path: string) => files.get(path) ?? (() => {throw new Error("missing");})(),
    stat: (path: string) => ({mode: directories.has(path) ? 0o040000 : 0o100000, size: files.get(path)?.length ?? 0}),
    isDir: (mode: number) => (mode & 0o170000) === 0o040000,
    unlink: (path: string) => {files.delete(path);},
    rmdir: (path: string) => {directories.delete(path);},
    writeFile: (path: string, data: Uint8Array) => {files.set(path, new Uint8Array(data));},
  };
}

describe("Lutro native saves", () => {
  it("exports progress and imports it before a new game instance reads its files", () => {
    const first = memoryFs();
    first.mkdir("/data/saves/lutro/lutro-native");
    first.mkdir("/data/saves/lutro/lutro-native/Sienna");
    first.writeFile("/data/saves/lutro/lutro-native/Sienna/status", new Uint8Array([0, 1, 255]));
    const bytes = captureLutroNativeSave(first, "Sienna.lutro", 1024);
    expect(bytes.length).toBeGreaterThan(0);
    const second = memoryFs();
    second.mkdir("/data/saves/lutro/lutro-native");
    second.mkdir("/data/saves/lutro/lutro-native/Sienna");
    second.writeFile("/data/saves/lutro/lutro-native/Sienna/stale", new Uint8Array([9]));
    importLutroNativeSave(second, "Sienna.lutro", bytes, 1024);
    expect([...second.files.keys()]).toEqual(["/data/saves/lutro/lutro-native/Sienna/status"]);
    expect(second.readFile("/data/saves/lutro/lutro-native/Sienna/status")).toEqual(new Uint8Array([0, 1, 255]));
    const fresh = memoryFs();
    importLutroNativeSave(fresh, "Sienna.lutro", bytes, 1024);
    expect(fresh.analyzePath("/data/saves/lutro").exists).toBe(true);
    expect(fresh.readFile("/data/saves/lutro/lutro-native/Sienna/status")).toEqual(new Uint8Array([0, 1, 255]));
  });

  it("rejects empty saves and invalid content identity", () => {
    expect(() => captureLutroNativeSave(memoryFs(), "Snake.lutro", 1024)).toThrow("PLAYER_STATE_UNAVAILABLE");
    expect(() => captureLutroNativeSave(memoryFs(), "../Snake.lutro", 1024)).toThrow("PLAYER_STATE_UNAVAILABLE");
  });

  it("passes a .lutro ZIP intact and restores native files before the core starts", async () => {
    const source = memoryFs();
    source.mkdir("/data/saves/lutro/lutro-native");
    source.mkdir("/data/saves/lutro/lutro-native/Sienna");
    source.writeFile("/data/saves/lutro/lutro-native/Sienna/progress", new Uint8Array([4, 0, 8]));
    const save = captureLutroNativeSave(source, "Sienna.lutro", 1024);
    const target = memoryFs();
    let imported = false;
    let coreStarted = false;
    const instance = {
      fileName: "Sienna.lutro",
      gameManager: {FS: target},
      checkCompression: async () => {throw new Error("LUTRO_ZIP_EXTRACTED");},
      startGame: () => {
        expect(target.readFile("/data/saves/lutro/lutro-native/Sienna/progress")).toEqual(new Uint8Array([4, 0, 8]));
        expect(imported).toBe(true);
        coreStarted = true;
      },
    } as unknown as EjsInstance;
    installLutroNativeRestore("lutro", instance, save, 1024, () => {imported = true;}, error => {throw error;});
    const archive = new Uint8Array([80, 75, 3, 4, 0, 255]);
    let forwarded: Uint8Array | undefined;
    await instance.checkCompression!(archive, "Decompress Game Data", (name, data) => {
      expect(name).toBe("!!notCompressedData"); forwarded = data;
    });
    expect(forwarded).toBe(archive);
    instance.startGame!();
    expect(coreStarted).toBe(true);
  });

  it("keeps current native writes when the core starts again", () => {
    const source = memoryFs();
    source.mkdir("/data/saves/lutro/lutro-native");
    source.mkdir("/data/saves/lutro/lutro-native/Sienna");
    source.writeFile("/data/saves/lutro/lutro-native/Sienna/progress", new Uint8Array([1]));
    const save = captureLutroNativeSave(source, "Sienna.lutro", 1024);
    const target = memoryFs();
    let imports = 0;
    let starts = 0;
    const instance = {fileName: "Sienna.lutro", gameManager: {FS: target},
      checkCompression: async () => undefined, startGame: () => {starts += 1;}} as unknown as EjsInstance;
    installLutroNativeRestore("lutro", instance, save, 1024, () => {imports += 1;}, error => {throw error;});
    instance.startGame!();
    target.writeFile("/data/saves/lutro/lutro-native/Sienna/progress", new Uint8Array([2]));
    instance.startGame!();
    expect(starts).toBe(2);
    expect(imports).toBe(1);
    expect(target.readFile("/data/saves/lutro/lutro-native/Sienna/progress")).toEqual(new Uint8Array([2]));
  });

  it("advertises changed native data once and acknowledges only the persisted revision", async () => {
    const fs = memoryFs();
    const events = [] as Array<{available: boolean; reason: string | null; revision?: string}>;
    const instance = {fileName: "Sienna.lutro", gameManager: {FS: fs}} as unknown as EjsInstance;
    const tracker = new LutroNativeSaveTracker(instance, 1024, false, value => events.push(value));
    await tracker.refresh();
    expect(tracker.getAvailability()).toMatchObject({available: false, reason: "NO_SAVE",
      save: {capture: "IN_GAME", restore: "AUTOMATIC", captureAvailable: false}});
    fs.mkdir("/data/saves/lutro/lutro-native");
    fs.mkdir("/data/saves/lutro/lutro-native/Sienna");
    fs.writeFile("/data/saves/lutro/lutro-native/Sienna/progress", new Uint8Array([1]));
    await tracker.refresh();
    const first = tracker.getAvailability();
    expect(first).toMatchObject({available: true, reason: null, save: {dataKind: "STORAGE"}});
    expect(first.revision).toMatch(/^[0-9a-f]{64}$/u);
    const saved = await tracker.capture();
    await tracker.acknowledge(saved);
    expect(tracker.getAvailability()).toMatchObject({available: false, reason: "UNCHANGED"});
    fs.writeFile("/data/saves/lutro/lutro-native/Sienna/progress", new Uint8Array([2]));
    await tracker.refresh();
    expect(tracker.getAvailability().revision).not.toBe(first.revision);
    await expect(tracker.acknowledge(saved)).rejects.toThrow("PLAYER_STATE_UNAVAILABLE");
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
});
