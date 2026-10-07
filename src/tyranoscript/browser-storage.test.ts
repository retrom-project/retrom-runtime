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
