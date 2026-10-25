import {afterEach, expect, it, vi} from "vitest";
import {currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import {config, enableRuntimeFeatures, fakeVlfs, loadCore, loadVlfs, mockDownloads, type HostWindow} from "../../tests/kirikiri-adapter-fixture.js";
import {createRuntime} from "../index.js";
import {decodeStoredCheckpoint} from "../provider/checkpoint-storage.js";
import {decodeKirikiriCheckpoint, encodeKirikiriCheckpoint} from "./checkpoint.js";

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
  delete (window as HostWindow).Module; delete (window as HostWindow).VLFS;
  document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach(script => script.remove());
  document.body.replaceChildren();
});

it("declares native GAME_SAVE with only the current native-file format", () => {
  expect(config().runtime.checkpoint).toMatchObject({semantics: "GAME_SAVE",
    writeFormat: "kirikiri-game-save-v1-storage-v1", readFormats: ["kirikiri-game-save-v1-storage-v1"]});
});

it("syncs files from a completed native save without creating a hidden host slot", async () => {
  enableRuntimeFeatures(); mockDownloads();
  const vlfs = fakeVlfs();
  const runtime = await createRuntime(config(), currentWindowHost(null));
  const mounting = runtime.mount(document.createElement("div"));
  await loadVlfs(vlfs); const module = await loadCore(vlfs); await mounting;
  try {
    vlfs.onWriteClose?.("/profiles/玩家/settings.ksd", Uint8Array.of(7));
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "NO_SAVE"});
    const notify = module.onGameSave as (event: {phase: string; id: number; success?: boolean}) => void;
    expect(notify).toBeTypeOf("function");
    notify({phase: "begin", id: 1});
    vlfs.onWriteClose?.("/profiles/玩家/任意槽.png", Uint8Array.of(1, 2));
    vlfs.onWriteClose?.("/profiles/玩家/任意槽.png", Uint8Array.of(1, 2, 3, 4));
    notify({phase: "end", id: 1, success: true});
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: true,
      save: {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false, dataKind: "PROGRESS"}});
    const checkpoint = await runtime.checkpoint();
    expect(checkpoint.format).toBe("kirikiri-game-save-v1-storage-v1");
    const payload = await decodeStoredCheckpoint(checkpoint.bytes, checkpoint.format, 64 * 1024 * 1024);
    expect(await decodeKirikiriCheckpoint(payload)).toEqual({progressPaths: ["profiles/玩家/任意槽.png"], entries: [
      {path: "profiles/玩家/settings.ksd", data: Uint8Array.of(7)},
      {path: "profiles/玩家/任意槽.png", data: Uint8Array.of(1, 2, 3, 4)},
    ]});
    expect(module._krkr2_host_save_bookmark).not.toHaveBeenCalled();
    expect(module._krkr2_host_load_bookmark).not.toHaveBeenCalled();
  } finally {await runtime.exit();}
});

it("imports native files before ordinary startup without requesting an automatic bookmark load", async () => {
  enableRuntimeFeatures(); mockDownloads(); const vlfs = fakeVlfs();
  const payload = await encodeKirikiriCheckpoint({progressPaths: ["custom/slot.kdt"], entries: [
    {path: "custom/slot.kdt", data: Uint8Array.of(4, 2)},
  ]});
  const runtime = await createRuntime(config(), currentWindowHost(payload));
  const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
  const module = await loadCore(vlfs, {bookmarkReady: 0, loadReady: 0, restoreState: 1}); await mounting;
  try {
    expect(vlfs.registerOverlayFile).toHaveBeenCalledWith("/custom/slot.kdt", Uint8Array.of(4, 2));
    expect(module._krkr2_host_load_bookmark).not.toHaveBeenCalled();
    expect(module._krkr2_host_load_bookmark_is_ready).not.toHaveBeenCalled();
    expect(module._krkr2_host_load_bookmark_state).not.toHaveBeenCalled();
    expect(runtime.getState()).toBe("RUNNING");
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "UNCHANGED"});
  } finally {await runtime.exit();}
});

it.each([-3, -5])("reports native observation failure %s instead of polling NOT_READY forever", async code => {
  enableRuntimeFeatures(); mockDownloads(); const vlfs = fakeVlfs();
  const runtime = await createRuntime(config(), currentWindowHost(null));
  const failures: Array<{type: string; failure?: {code: string; diagnostics?: unknown}}> = [];
  runtime.subscribe(event => failures.push(event));
  const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
  const module = await loadCore(vlfs); await mounting;
  module._krkr2_host_observe_game_saves.mockReturnValue(code);
  await vi.waitFor(() => expect(runtime.getState()).toBe("FAILED"));
  expect(failures.filter(event => event.type === "FATAL_ERROR")).toEqual([
    expect.objectContaining({failure: expect.objectContaining({code: "KIRIKIRI_GAME_SAVE_OBSERVER_FAILED",
      diagnostics: expect.arrayContaining([{source: "CORE", message: `Native save observer returned ${code}.`}])})}),
  ]);
  expect(module.krkr2StopMainLoop).toHaveBeenCalledOnce();
});
