import {expect, vi} from "vitest";
import {targetEnvelope} from "./provider-fixtures.js";

type FakeModule = {
  locateFile: (path: string) => string;
  onAbort?: (reason: unknown) => void;
  onExit?: (status: number) => void;
  onNativeExitRequested?: (status: number) => void;
  onScriptException?: (detail: {message: string; script: string; line: number; trace: string}) => void;
  onGameSave?: (event: {phase: "begin" | "end"; id: number; success?: boolean}) => void;
  postRun: Array<() => void>;
  pauseMainLoop: ReturnType<typeof vi.fn>;
  resumeMainLoop: ReturnType<typeof vi.fn>;
  krkr2StopMainLoop: ReturnType<typeof vi.fn>;
  _krkr2_host_bookmark_is_ready: ReturnType<typeof vi.fn>;
  _krkr2_host_load_bookmark_is_ready: ReturnType<typeof vi.fn>;
  _krkr2_host_load_bookmark: ReturnType<typeof vi.fn>;
  _krkr2_host_load_bookmark_state: ReturnType<typeof vi.fn>;
  _krkr2_host_save_bookmark: ReturnType<typeof vi.fn>;
  _krkr2_host_observe_game_saves: ReturnType<typeof vi.fn>;
  _krkr2_host_flush_game_saves: ReturnType<typeof vi.fn>;
  _krkr2_host_finalize_native_exit: ReturnType<typeof vi.fn>;
  _startupXp3Path?: string;
  [key: string]: unknown;
};
type FakeVlfs = ReturnType<typeof fakeVlfs>;
export type HostWindow = Window & { Module?: Partial<FakeModule>; VLFS?: FakeVlfs };

export function config() {return targetEnvelope("kirikiri2-kag");}

export function enableRuntimeFeatures() {
  Object.defineProperty(window, "crossOriginIsolated", { configurable: true, value: true });
  Object.defineProperty(window, "SharedArrayBuffer", { configurable: true, value: SharedArrayBuffer });
  Object.defineProperty(window.WebAssembly, "Suspending", { configurable: true, value: function Suspending() {} });
  Object.defineProperty(window.WebAssembly, "promising", { configurable: true, value: (operation: (...args: unknown[]) => unknown) => async (...args: unknown[]) => operation(...args) });
}

export function mockDownloads(xp3Paths = ["/data.xp3"]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("assets.zip")) {return new Response(Uint8Array.of(1), { status: 200 });}
    if (url.endsWith("/index.json") && !init?.method) {
      return Response.json({ schemaVersion: 1, files: [
        ...xp3Paths.map((path) => ({
          path: path.replace(/^\//u, ""), sizeBytes: 1234, sha256: "a".repeat(64), mediaType: "application/octet-stream",
          url: `/runtime/content/project/${"a".repeat(64)}${path}`,
        })),
        {
          path: "startup.tjs", sizeBytes: 40, sha256: "a".repeat(64), mediaType: "application/octet-stream",
          url: `/runtime/content/project/${"a".repeat(64)}/startup.tjs`,
        },
      ] });
    }
    throw new Error(`unexpected request: ${url}`);
  }));
}

export function fakeVlfs() {
  const value = {
    init: vi.fn(async () => undefined),
    mkdir: vi.fn(() => 0),
    onWriteClose: null as ((path: string, data: Uint8Array) => void) | null,
    onUnlink: null as ((path: string) => void) | null,
    unlink: vi.fn(() => 0),
    registerOverlayFile: vi.fn(),
    contentAbi: "content-io-v1",
    contractSha256: "9601f63ba9d1bad095b42b32a3d6167166535be246a87f0efac7c5b125ed27bf",
    registerContent: vi.fn(),
    registerZipBlob: vi.fn(async () => ({ paths: ["/ui/font.ttf"], xp3Paths: [] as string[] })),
  };
  return value;
}

export async function loadVlfs(vlfs: FakeVlfs) {
  await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(1));
  (window as HostWindow).VLFS = vlfs;
  runtimeScripts()[0]!.dispatchEvent(new Event("load"));
}

export async function loadCore(
  vlfs: FakeVlfs,
  options: { bookmarkReady?: number; loadReady?: number; restoreResult?: number; restoreState?: number; abort?: boolean; stopping?: Promise<void> } = {},
) {
  await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(2));
  const configured = (window as HostWindow).Module ?? {};
  const module = Object.assign(configured, {
    pauseMainLoop: vi.fn(),
    resumeMainLoop: vi.fn(),
    krkr2StopMainLoop: vi.fn(() => options.stopping ?? Promise.resolve()),
    _krkr2_host_observe_game_saves: vi.fn(() => 1),
    _krkr2_host_flush_game_saves: vi.fn(async () => 0),
    _krkr2_host_finalize_native_exit: vi.fn(async () => 0),
    _krkr2_host_bookmark_is_ready: vi.fn(() => options.bookmarkReady ?? 1),
    _krkr2_host_load_bookmark_is_ready: vi.fn(() => options.loadReady ?? 1),
    _krkr2_host_load_bookmark: vi.fn(() => options.restoreResult ?? 0),
    _krkr2_host_load_bookmark_state: vi.fn(() => options.restoreState ?? 2),
    _krkr2_host_save_bookmark: vi.fn((slot: number) => {
      vlfs.onWriteClose?.(`/savedata/data${slot}.ksd`, Uint8Array.of(1, 9, 9, 9));
      vlfs.onWriteClose?.("/savedata/datasu.ksd", Uint8Array.of(2, 8));
      return 0;
    }),
  }) as FakeModule;
  (window as HostWindow).Module = module;
  runtimeScripts()[1]!.dispatchEvent(new Event("load"));
  if (options.abort) {(module.onAbort as () => void)();}
  else {module.postRun[0]?.();}
  return module;
}

export function runtimeScripts() {
  return [...document.head.querySelectorAll<HTMLScriptElement>("script[data-runtime=kirikiri2]")];
}
