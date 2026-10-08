import {beforeEach, expect, it, vi} from "vitest";
import type {MameCore} from "./core.js";
import {mountMame} from "./adapter.js";
import {eagerPolicy} from "../provider/content-policies.js";
const state = vi.hoisted(() => ({core: null as unknown as MameCore}));
vi.mock("./core.js", async original => ({...await original<typeof import("./core.js")>(),
  loadCore: async () => ({core: state.core, build: "build"})}));
vi.mock("./files.js", () => ({mountFiles: async () => "identity"}));
vi.mock("./state.js", () => ({checkpointFormat: "format", checkpointLimit: 1024,
  decodeState: async () => new Uint8Array([1, 2]), encodeState: async () => new Uint8Array([1])}));
vi.mock("./input.js", () => ({installInput: () => ({stop: vi.fn(), input: {poll: vi.fn(), clear: vi.fn()}})}));
vi.mock("./video.js", () => ({createVideo: () => ({canvas: document.createElement("canvas"), draw: vi.fn()}), captureVideo: vi.fn()}));
vi.mock("./audio.js", () => ({MameAudio: class {resume = async () => {}; pause = async () => {}; stop = async () => {}; push = () => {};}}));
const content = {assetIndex: {}, contentSession: {inputPolicy: () => eagerPolicy(32768),
  open: async () => {throw Error("unused");}, materialize: async () => {throw Error("unused");}, closeFile: async () => {}}};
beforeEach(() => {
  state.core = {HEAPU8: new Uint8Array(1024), _malloc: () => 16, _free: vi.fn(),
    _retrom_mame_start: vi.fn(() => 1), _retrom_mame_step: vi.fn(() => 1), _retrom_mame_stop: vi.fn(),
    _retrom_mame_restore: vi.fn(() => 1), _retrom_mame_aspect_ratio: () => 4 / 3,
    _retrom_mame_fps: () => 60, _retrom_mame_sample_rate: () => 48000} as unknown as MameCore;
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
const game = {url: "/game", sizeBytes: 32768, sha256: "a".repeat(64)};
it.each(["sg1000", "coleco", "pv1000"] as const)("restores %s immediately after native start is ready without advancing guest time", async machine => {
  const adapter = await mountMame({machine, game, bios: [], runtimeBaseUrl: "/"}, document.body, window, new Uint8Array([1]), content);
  expect(state.core._retrom_mame_start).toHaveBeenCalledOnce();
  expect(state.core._retrom_mame_restore).toHaveBeenCalledOnce();
  expect(state.core._retrom_mame_step).not.toHaveBeenCalled();
  await adapter.exit();
  expect(state.core._retrom_mame_stop).toHaveBeenCalledOnce();
});
it("rejects failed native startup before restoration and cleans up", async () => {
  vi.mocked(state.core._retrom_mame_start).mockReturnValue(0);
  await expect(mountMame({machine: "coleco", game, bios: [], runtimeBaseUrl: "/"}, document.body, window,
    new Uint8Array([1]), content)).rejects.toThrow("MAME_BOOT_FAILED");
  expect(state.core._retrom_mame_restore).not.toHaveBeenCalled();
  expect(state.core._retrom_mame_stop).toHaveBeenCalledOnce();
});
