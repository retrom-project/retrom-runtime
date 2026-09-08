import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mountFantasyConsole} from "./adapter.js";
import {loadCore, type NativeCore, type FantasyParameters} from "./core.js";
import {decodeState, encodeState} from "./state.js";
vi.mock("./core.js", async (original) => ({...await original<typeof import("./core.js")>(), loadCore: vi.fn()}));
vi.mock("./audio.js", () => ({FantasyAudio: class {
  resume = vi.fn(async () => undefined); pause = vi.fn(async () => undefined);
  stop = vi.fn(async () => undefined); push = vi.fn(); setVolume = vi.fn();
}}));
const config: FantasyParameters = {core: "tic80", contentDigest: "a".repeat(64),
  cartUrl: "/cart", cartSizeBytes: 4, runtimeBaseUrl: "/provider/", assetIndex: {}};
let core: NativeCore;
let animation: FrameRequestCallback;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => Object.assign(
    Object.create(null), {
      createImageData: (w: number, h: number) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData: vi.fn(),
    },
  ));
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {animation = callback; return 1;});
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  core = {
    HEAPU8: new Uint8Array(200000), HEAP16: new Int16Array(100000),
    _malloc: () => 512, _free: vi.fn(), _retrom_abi: () => 1, _retrom_ready: () => 1, _retrom_load: vi.fn(() => 1),
    _retrom_step: vi.fn(() => 1), _retrom_stop: vi.fn(), _retrom_pixels: () => 2000,
    _retrom_audio: () => 0, _retrom_audio_count: () => 0, _retrom_state: () => 512,
    _retrom_state_size: () => 1024, _retrom_restore: vi.fn(() => 1),
  };
  vi.mocked(loadCore).mockResolvedValue({core, cart: new Uint8Array(4)});
});
afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});
function mount(restore: Uint8Array | null = null, signal?: AbortSignal) {
  return mountFantasyConsole(config, document.body, window, restore, vi.fn(), vi.fn(), signal);
}
describe("fantasy runtime lifecycle", () => {
  it("restores native data before the first frame and saves an authenticated bounded payload", async () => {
    const payload = new Uint8Array(1024); payload[0] = 99;
    const adapter = await mount(await encodeState("tic80", config.contentDigest, payload));
    expect(vi.mocked(core._retrom_restore).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(core._retrom_step).mock.invocationCallOrder[0]);
    const state = await adapter.checkpoint();
    expect(await decodeState("tic80", config.contentDigest, state.bytes)).toEqual(payload);
    await adapter.exit();
  });
  it("reports native data revisions and keeps newer changes after acknowledging an older save", async () => {
    const adapter = await mount();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d", {alpha: false, willReadFrequently: true});
    expect(adapter.getCheckpointAvailability()).toEqual({available: false, blocker: "NO_SAVE"});
    core.HEAPU8[512] = 1;
    expect(adapter.getCheckpointAvailability()).toEqual({available: true, blocker: null, revision: "1"});
    const saved = await adapter.checkpoint(); core.HEAPU8[512] = 2;
    await adapter.acknowledgeCheckpoint?.(saved);
    expect(adapter.getCheckpointAvailability()).toEqual({available: true, blocker: null, revision: "2"});
    await adapter.acknowledgeCheckpoint?.(await adapter.checkpoint());
    expect(adapter.getCheckpointAvailability()).toEqual({available: false, blocker: "UNCHANGED"});
    await adapter.exit();
  });
  it("releases keyboard on pause and blur, resumes frames and disposes once on abort", async () => {
    const controller = new AbortController();
    const adapter = await mount(null, controller.signal);
    window.dispatchEvent(new KeyboardEvent("keydown", {code: "ArrowRight"})); animation(100);
    expect(core._retrom_step).toHaveBeenLastCalledWith(8);
    await adapter.pause(); const frames = adapter.getFrameCount(); animation(120);
    expect(adapter.getFrameCount()).toBe(frames);
    await adapter.resume(); animation(150);
    expect(core._retrom_step).toHaveBeenLastCalledWith(0);
    window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyZ"}));
    window.dispatchEvent(new Event("blur")); animation(200);
    expect(core._retrom_step).toHaveBeenLastCalledWith(0);
    controller.abort(); await adapter.exit();
    expect(core._retrom_stop).toHaveBeenCalledTimes(1);
    expect(adapter.getCanvas()).toBeNull();
    await expect(adapter.checkpoint()).rejects.toThrow("FANTASY_RUNTIME_STOPPED");
  });
  it("fails before loading for foreign saves and cleans a failed native restore", async () => {
    await expect(mount(await encodeState("tic80", "b".repeat(64), new Uint8Array(1024))))
      .rejects.toThrow();
    expect(core._retrom_load).not.toHaveBeenCalled();
    vi.mocked(core._retrom_restore).mockReturnValue(0);
    await expect(mount(await encodeState("tic80", config.contentDigest, new Uint8Array(1024))))
      .rejects.toThrow("FANTASY_CHECKPOINT_RESTORE_FAILED");
    expect(core._retrom_stop).toHaveBeenCalledOnce();
    expect(core._retrom_step).not.toHaveBeenCalled();
  });
});
