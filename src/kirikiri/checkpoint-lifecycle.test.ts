import {afterEach, expect, it, vi} from "vitest";
import {currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import {createRuntime} from "../index.js";
import {decodeStoredCheckpoint} from "../provider/checkpoint-storage.js";
import {decodeKirikiriCheckpoint} from "./checkpoint.js";
import {targetEnvelope} from "../../tests/provider-fixtures.js";
import {contractSha256} from "../content-io/identity.js";
import {suspendingBookmark, type KirikiriJspi} from "../../tests/kirikiri-checkpoint-fixture.js";

vi.mock("./content.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./content.js")>();
  return {...actual, KirikiriContent: class extends actual.KirikiriContent {
    override async assets(base: URL) {
      return {vlfsUrl: new URL("vlfs.js", base).href, scriptUrl: new URL("index.js", base).href,
        wasmUrl: "blob:kirikiri-verified-wasm", archive: new Blob([Uint8Array.of(1)])};
    }
  }};
});

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (window as RuntimeWindow).Module; delete (window as RuntimeWindow).VLFS;
  document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach(script => script.remove());
  document.body.replaceChildren();
});

it.each(["/savedata/data0.png", "/profiles/玩家/进度/任意槽.kdt"])(
  "syncs a completed native cold-write at the original virtual path %s", async path => {
  const wasm = window.WebAssembly as KirikiriJspi;
  Object.defineProperty(window, "crossOriginIsolated", {configurable: true, value: true});
  Object.defineProperty(window, "SharedArrayBuffer", {configurable: true, value: SharedArrayBuffer});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({schemaVersion: 1, files: [
    {path: "data.xp3", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "/game/data.xp3"},
  ]})));
  let finishRead!: () => void;
  const reading = new Promise<void>(resolve => {finishRead = resolve;});
  const vlfs = {
    init: async () => undefined, mkdir: () => 0, unlink: () => 0,
    onWriteClose: null as ((path: string, bytes: Uint8Array) => void) | null,
    onUnlink: null as ((path: string) => void) | null,
    registerOverlayFile() {}, registerContent() {}, registerZipBlob: async () => ({}),
    contentAbi: "content-io-v1", contractSha256,
  };
  const nativeWrite = wasm.promising(suspendingBookmark(wasm, () => reading.then(() => {
    vlfs.onWriteClose?.(path, Uint8Array.of(4, 2));
  })));
  const runtime = await createRuntime(targetEnvelope("kirikiri2-kag"), currentWindowHost(null));
  const mounting = runtime.mount(document.createElement("div"));
  await vi.waitFor(() => expect(scripts()).toHaveLength(1));
  const host = window as RuntimeWindow;
  host.VLFS = vlfs; scripts()[0]!.dispatchEvent(new Event("load"));
  await vi.waitFor(() => expect(scripts()).toHaveLength(2));
  const module = Object.assign(host.Module!, {
    pauseMainLoop: vi.fn(async () => undefined), resumeMainLoop: vi.fn(),
    krkr2StopMainLoop: vi.fn(async (active?: Promise<unknown>) => {await active?.catch(() => undefined);}),
    _krkr2_host_bookmark_is_ready: () => 1, _krkr2_host_observe_game_saves: () => 1,
    _krkr2_host_flush_game_saves: async () => 0,
    _krkr2_host_finalize_native_exit: async () => 0,
    _krkr2_host_save_bookmark: vi.fn(), _krkr2_host_load_bookmark: vi.fn(),
  });
  scripts()[1]!.dispatchEvent(new Event("load")); module.postRun[0]?.(); await mounting;
  const notify = module.onGameSave;
  notify({phase: "begin", id: 1, history: true});
  const writing = nativeWrite(0).then(() => {notify({phase: "end", id: 1, success: true});});
  try {
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "NOT_READY"});
    finishRead(); await writing;
    const saved = await runtime.checkpoint();
    const payload = await decodeStoredCheckpoint(saved.bytes, saved.format, 64 * 1024 * 1024);
    expect(await decodeKirikiriCheckpoint(payload)).toEqual({progressPaths: [path.slice(1)],
      entries: [{path: path.slice(1), data: Uint8Array.of(4, 2)}]});
    expect(module._krkr2_host_save_bookmark).not.toHaveBeenCalled();
    expect(module._krkr2_host_load_bookmark).not.toHaveBeenCalled();
  } finally {finishRead(); await writing; await runtime.exit();}
});

type RuntimeWindow = Window & {
  Module?: {postRun: Array<() => void>; onGameSave(event: {phase: "begin" | "end"; id: number; success?: boolean; history?: boolean}): void};
  VLFS?: unknown;
};
function scripts() {return [...document.head.querySelectorAll<HTMLScriptElement>("script[data-runtime=kirikiri2]")];}
