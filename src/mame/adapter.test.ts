import {beforeEach, expect, it, vi} from "vitest";
import type {MameCore} from "./core.js";
import {mountMame} from "./adapter.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {CoreDiagnostics} from "../provider/core-diagnostics.js";
import {RuntimeFailureError} from "../provider/failure.js";
import {installTouchGamepad} from "../provider/touch-gamepad.js";
const diagnostics = new CoreDiagnostics();
const state = vi.hoisted(() => ({core: null as unknown as MameCore}));
vi.mock("./core.js", async original => ({...await original<typeof import("./core.js")>(),
  loadCore: async () => ({core: state.core, build: "build", diagnostics})}));
vi.mock("./files.js", () => ({mountFiles: async () => "identity"}));
vi.mock("./state.js", () => ({checkpointFormat: "format", checkpointLimit: 1024,
  decodeState: async () => new Uint8Array([1, 2]), encodeState: async () => new Uint8Array([1])}));
vi.mock("./input.js", () => ({installInput: () => ({stop: vi.fn(), input: {poll: vi.fn(), clear: vi.fn()}})}));
vi.mock("./video.js", () => ({createVideo: () => ({canvas: document.createElement("canvas"), draw: vi.fn()}), captureVideo: vi.fn()}));
vi.mock("./audio.js", () => ({MameAudio: class {resume = async () => {}; pause = async () => {}; stop = async () => {}; push = () => {};}}));
const content = {assetIndex: {}, contentSession: {inputPolicy: () => eagerPolicy(32768),
  open: async () => {throw Error("unused");}, materialize: async () => {throw Error("unused");}, closeFile: async () => {}}};
beforeEach(() => {
  diagnostics.clear();
  state.core = {HEAPU8: new Uint8Array(1024), _malloc: vi.fn(() => 16), _free: vi.fn(),
    _retrom_mame_start: vi.fn(() => 1), _retrom_mame_step: vi.fn(() => 1), _retrom_mame_stop: vi.fn(),
    _retrom_mame_restore: vi.fn(() => 1), _retrom_mame_save_size: vi.fn(() => 8), _retrom_mame_save: vi.fn(() => 1),
    _retrom_mame_aspect_ratio: () => 4 / 3,
    _retrom_mame_fps: () => 60, _retrom_mame_sample_rate: () => 48000} as unknown as MameCore;
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
const game = {url: "/game", sizeBytes: 32768, sha256: "a".repeat(64)};
it.each([
  {machine: "pv1000", arcade: false, index: 9, label: "Start", keys: [], buttons: [3]},
  {machine: "sg1000", arcade: false, index: 9, label: "暂停", keys: [49], buttons: []},
  {machine: "coleco", arcade: false, index: 9, label: "1", keys: [257], buttons: []},
  {machine: "1942", arcade: true, index: 8, label: "投币", keys: [], buttons: [2]},
  {machine: "apple2p", arcade: false, index: 3, label: "Enter", keys: [13], buttons: []},
  {machine: "apple2e", arcade: false, index: 3, label: "Enter", keys: [13], buttons: []},
  {machine: "atom", arcade: false, index: 8, label: "Esc", keys: [27], buttons: []},
  {machine: "atom", arcade: false, index: 4, label: "Shift", keys: [304], buttons: []},
  {machine: "atom", arcade: false, index: 5, label: "REPT", keys: [305], buttons: []},
])("offers a shared touch layout with the native system input for $machine", async sample => {
  const {padState} = await vi.importActual<typeof import("./input.js")>("./input.js");
  const config = {...sample, game, bios: [], runtimeBaseUrl: "/"} as Parameters<typeof mountMame>[0];
  const adapter = await mountMame(config, document.body, window, null, content);
  const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: true})});
  const options = adapter.touchGamepad;
  let touch: ReturnType<typeof installTouchGamepad> | undefined;
  try {
    expect(options).toBeTruthy();
    if (!options || options === true) {throw new Error("Expected configured virtual controls");}
    touch = installTouchGamepad(window, options);
    const root = document.querySelector("[data-retrom-touch-gamepad]")!;
    const button = root.querySelector(`[data-button="${sample.index}"]`)!;
    expect(button.textContent).toBe(sample.label);
    button.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", pointerId: 1}));
    expect(padState([touch.current() as Gamepad], sample.machine, sample.arcade)).toMatchObject({keys: sample.keys, buttons: sample.buttons});
    await touch.setEnabled(false);
    expect(touch.current()).toBeNull();
  } finally {touch?.cleanup(); await adapter.exit(); focus.mockRestore(); Reflect.deleteProperty(window, "matchMedia"); document.body.replaceChildren();}
});
it.each(["sg1000", "coleco", "pv1000"] as const)("restores %s immediately after native start is ready without advancing guest time", async machine => {
  const adapter = await mountMame({machine, game, bios: [], runtimeBaseUrl: "/"}, document.body, window, new Uint8Array([1]), content);
  expect(state.core._retrom_mame_start).toHaveBeenCalledOnce();
  expect(state.core._retrom_mame_restore).toHaveBeenCalledOnce();
  expect(state.core._retrom_mame_step).not.toHaveBeenCalled();
  await adapter.exit();
  expect(state.core._retrom_mame_stop).toHaveBeenCalledOnce();
});
it("rejects failed native startup before restoration and cleans up", async () => {
  diagnostics.record("program.bin NOT FOUND\nFatal error: Required files are missing.");
  vi.mocked(state.core._retrom_mame_start).mockReturnValue(0);
  const failure = await mountMame({machine: "coleco", game, bios: [], runtimeBaseUrl: "/"}, document.body, window,
    new Uint8Array([1]), content).catch(error => error);
  expect(failure).toBeInstanceOf(RuntimeFailureError);
  expect(failure).toMatchObject({code: "MAME_BOOT_FAILED", category: "CONTENT", diagnostics: ["program.bin NOT FOUND", "Fatal error: Required files are missing."]});
  expect(diagnostics.messages()).toEqual([]);
  expect(state.core._retrom_mame_restore).not.toHaveBeenCalled();
  expect(state.core._retrom_mame_stop).toHaveBeenCalledOnce();
});
it.each([0, 917])("disables unusable checkpoints of %i native bytes before capture", async size => {
  vi.mocked(state.core._retrom_mame_save_size).mockReturnValue(size);
  const adapter = await mountMame({machine: "coleco", game, bios: [], runtimeBaseUrl: "/"}, document.body, window, null, content);
  expect(adapter.getCheckpointAvailability?.()).toEqual({available: false, blocker: "UNSUPPORTED"});
  vi.mocked(state.core._malloc).mockClear();
  await expect(adapter.checkpoint?.()).rejects.toThrow("MAME_CHECKPOINT_UNAVAILABLE");
  expect(state.core._malloc).not.toHaveBeenCalled();
  expect(state.core._retrom_mame_save).not.toHaveBeenCalled();
  await adapter.exit();
});
it("allows native checkpoints at the exact declared payload boundary", async () => {
  vi.mocked(state.core._retrom_mame_save_size).mockReturnValue(916);
  const adapter = await mountMame({machine: "coleco", game, bios: [], runtimeBaseUrl: "/"}, document.body, window, null, content);
  expect(adapter.getCheckpointAvailability?.()).toEqual({available: true, blocker: null});
  await expect(adapter.checkpoint?.()).resolves.toEqual({bytes: new Uint8Array([1]), format: "format"});
  expect(state.core._retrom_mame_save).toHaveBeenCalledWith(16, 916);
  await adapter.exit();
  expect(adapter.getCheckpointAvailability?.()).toEqual({available: false, blocker: "NOT_READY"});
});
