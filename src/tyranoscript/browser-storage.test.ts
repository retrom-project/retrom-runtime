// @vitest-environment node
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {expect, it, vi} from "vitest";

function install(global: Record<string, unknown>): () => void {
  const source = readFileSync("assets/runtime/tyranoscript/browser-storage.js", "utf8");
  return runInNewContext(source.replace("export function", "function") + "\ninstallTyranoBrowserStorage(global)", {global});
}
it("redirects desktop storage before asynchronous engine initialization, including later library definitions", () => {
  const global: Record<string, unknown> = {}, cleanup = install(global);
  const library = {getStorageFile: vi.fn((_key: string) => "null"), getStorageWeb: vi.fn((_key: string) => null),
    setStorageFile: vi.fn((_key: string, _value: unknown) => {}), setStorageWeb: vi.fn((_key: string, _value: unknown) => {})};
  const original = library.getStorageFile;
  global.$ = library;
  const replaced = vi.fn((_key: string) => "null");
  library.getStorageFile = replaced;
  expect(library.getStorageFile("project_sf")).toBeNull();
  expect(library.getStorageWeb).toHaveBeenCalledWith("project_sf");
  expect(original).not.toHaveBeenCalled(); expect(replaced).not.toHaveBeenCalled();
  library.setStorageFile("project_sf", {counter: 2});
  expect(library.setStorageWeb).toHaveBeenCalledWith("project_sf", {counter: 2});
  cleanup();
  expect(global.$).toBe(library); expect(library.getStorageFile).toBe(replaced);
});
it("preserves the engine's browser serialization and does not overwrite another owner's cleanup", () => {
  const state = new Map<string, string>();
  const library = {getStorageWeb: (key: string) => state.get(key) ?? null,
    setStorageWeb: (key: string, value: unknown) => {state.set(key, JSON.stringify(value));}};
  const global = {$: library, jQuery: library}, cleanup = install(global);
  const adapted = library as typeof library & {getStorageFile(key: string): string | null; setStorageFile(key: string, value: unknown): void};
  adapted.setStorageFile("sf", {counter: 3});
  expect(JSON.parse(adapted.getStorageFile("sf")!)).toEqual({counter: 3});
  Object.defineProperty(global, "$", {value: "other", configurable: true});
  cleanup(); expect(global.$).toBe("other");
});

it("initializes legacy system variables and round-trips the legacy escaped JSON storage format", () => {
  const state = new Map<string, string>();
  const localStorage = {getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => {state.set(key, value);}};
  const global: Record<string, unknown> = {localStorage}, cleanup = install(global);
  const library = {} as {getStorage(key: string): string | null; setStorage(key: string, value: unknown): void};
  global.jQuery = library; global.$ = library;
  // Older engines define these direct desktop implementations after publishing jQuery.
  const desktopRead = vi.fn((_key: string) => "null");
  const desktopWrite = vi.fn((_key: string, _value: unknown) => {throw new Error("require is not defined");});
  library.getStorage = desktopRead; library.setStorage = desktopWrite;
  const stored = library.getStorage("project_sf");
  const variables = stored == null ? {} : JSON.parse(stored);
  expect(() => {variables.system = {};}).not.toThrow();
  const value = {counter: 7, text: "日本語 / 中文 / % + 空格", nested: {enabled: true}};
  library.setStorage("project_sf", value);
  expect(state.get("project_sf")).toBe(escape(JSON.stringify(value)));
  expect(JSON.parse(library.getStorage("project_sf")!)).toEqual(value);
  state.set("empty", "null");
  expect(library.getStorage("empty")).toBeNull();
  expect(desktopRead).not.toHaveBeenCalled(); expect(desktopWrite).not.toHaveBeenCalled();
  const laterRead = vi.fn((_key: string) => "null");
  library.getStorage = laterRead;
  expect(JSON.parse(library.getStorage("project_sf")!)).toEqual(value);
  cleanup(); cleanup();
  expect(library.getStorage).toBe(laterRead); expect(library.setStorage).toBe(desktopWrite);
});

it("keeps modern direct dispatchers, including their receiver, arguments and browser codec", () => {
  const global: Record<string, unknown> = {}, cleanup = install(global);
  const receiver = {custom: true}, callback = vi.fn();
  const getStorage = vi.fn(function (this: unknown, key: string, type: string) {
    expect(this).toBe(receiver); expect(type).toBe("compress");
    return `custom:${key}`;
  });
  const setStorage = vi.fn(function (this: unknown, _key: string, _value: unknown, done: () => void) {
    expect(this).toBe(receiver); done(); return "written";
  });
  const library = {getStorage, setStorage, getStorageWeb: vi.fn(), setStorageWeb: vi.fn()};
  global.$ = library;
  expect(library.getStorage.call(receiver, "sf", "compress")).toBe("custom:sf");
  expect(library.setStorage.call(receiver, "sf", {counter: 3}, callback)).toBe("written");
  expect(callback).toHaveBeenCalledOnce();
  expect(library.getStorageWeb).not.toHaveBeenCalled(); expect(library.setStorageWeb).not.toHaveBeenCalled();
  const previous = library.getStorage;
  const pluginRead = vi.fn(function (this: unknown, key: string, type: string) {
    return previous.call(this, key, type) + ":plugin";
  });
  library.getStorage = pluginRead;
  expect(library.getStorage.call(receiver, "sf", "compress")).toBe("custom:sf:plugin");
  cleanup();
  expect(library.getStorage).toBe(pluginRead); expect(library.setStorage).toBe(setStorage);
});

it("does not report a successful legacy write when browser storage fails", () => {
  const failure = new Error("storage quota exceeded");
  const desktopWrite = vi.fn((_key: string, _value: unknown) => {});
  const library = {setStorage: desktopWrite};
  const cleanup = install({$: library, localStorage: {setItem: () => {throw failure;}}});
  expect(() => library.setStorage("sf", {counter: 1})).toThrow(failure);
  expect(desktopWrite).not.toHaveBeenCalled();
  cleanup();
});
