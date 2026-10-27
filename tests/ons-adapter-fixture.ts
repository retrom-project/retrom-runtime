import {expect, vi} from "vitest";
import {targetEnvelope} from "./provider-fixtures.js";
import type {OnsContentBridge} from "../src/ons/project-files.js";

export type HostWindow = Window & {
  flush_save?: () => void;
  g_onsyuri_content?: OnsContentBridge;
  onsyuri?: (options: Record<string, unknown>) => Promise<FakeModule>;
  onsyuriHostReady?: () => void;
  scale_full?: (element: HTMLElement, ratio: number) => void;
};


export async function loadRuntimeScript() {
  await vi.waitFor(() => expect(document.head.querySelector("script[data-runtime=ons-yuri]")).not.toBeNull());
  document.head.querySelector<HTMLScriptElement>("script[data-runtime=ons-yuri]")?.dispatchEvent(new Event("load"));
}

export function config() {return targetEnvelope("onscripter-yuri");}

export function mockIndex() {
  const body = JSON.stringify({
    schemaVersion: 1,
    files: [
      { path: "0.txt", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/0.txt" },
      { path: "default.ttf", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/default.ttf" },
    ],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
}

export function fakeModule(): FakeModule {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const FS = new FakeFs();
  const module: FakeModule = {
    FS,
    callMain: vi.fn(() => {window.setTimeout(() => (window as HostWindow).onsyuriHostReady?.(), 0);}),
    _onsyuri_host_load: vi.fn(() => 0),
    _onsyuri_host_did_restore_fail: vi.fn(() => 0),
    _onsyuri_host_is_ready: vi.fn(() => 1),
    _onsyuri_host_checkpoint_ready: vi.fn(() => 1),
    _onsyuri_host_save: vi.fn((slot: number) => {
      FS.writeFile(`/save/save${slot}.dat`, Uint8Array.of(1, 2, 3));
      return 0;
    }),
    _onsyuri_host_set_paused: vi.fn(),
    _onsyuri_host_set_restore_slot: vi.fn(),
    _onsyuri_host_stop: vi.fn(),
  };
  return module;
}

export type FakeModule = {
  FS: FakeFs;
  callMain: ReturnType<typeof vi.fn>;
  onExit?: (status: number) => void;
  preRun?: () => void;
  printErr?: (message: string) => void;
  _onsyuri_host_load: ReturnType<typeof vi.fn>;
  _onsyuri_host_did_restore_fail: ReturnType<typeof vi.fn>;
  _onsyuri_host_is_ready: ReturnType<typeof vi.fn>;
  _onsyuri_host_checkpoint_ready: ReturnType<typeof vi.fn>;
  _onsyuri_host_save: ReturnType<typeof vi.fn>;
  _onsyuri_host_set_paused: ReturnType<typeof vi.fn>;
  _onsyuri_host_set_restore_slot: ReturnType<typeof vi.fn>;
  _onsyuri_host_stop: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
};

class FakeFs {
  private readonly directories = new Set(["/"]);
  private readonly files = new Map<string, Uint8Array>();

  mkdirTree(path: string) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {current += `/${part}`; this.directories.add(current);}
  }

  writeFile(path: string, bytes: Uint8Array) {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) {throw new Error("ENOENT");}
    this.files.set(path, bytes.slice());
  }

  readFile(path: string) {
    const value = this.files.get(path);
    if (!value) {throw new Error("ENOENT");}
    return value.slice();
  }

  readdir(path: string) {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set([".", ".."]);
    for (const item of [...this.directories, ...this.files.keys()]) {
      if (!item.startsWith(prefix)) {continue;}
      const name = item.slice(prefix.length).split("/")[0];
      if (name) {names.add(name);}
    }
    return [...names];
  }

  stat(path: string) {
    if (this.directories.has(path)) {return { mode: 16384 };}
    if (this.files.has(path)) {return { mode: 32768 };}
    throw new Error("ENOENT");
  }

  isDir(mode: number) {return mode === 16384;}
  unlink(path: string) {this.files.delete(path);}
}

export function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input);
}
