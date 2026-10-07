import {afterEach, expect, it, vi} from "vitest";
import {mountJ2me} from "./adapter.js";
import {RuntimeGamepadFilter} from "../provider/gamepad-filter.js";

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {await Promise.all(disposals.splice(0).map(dispose => dispose())); document.body.replaceChildren();});
const config = {sessionId: "input", contentDigest: "a".repeat(64), jarSizeBytes: 10,
  jarUrl: "http://localhost/game.jar", runtimeBaseUrl: "http://localhost/runtime/"};
function pad(index = 0) {
  return {index, connected: true, mapping: "standard", axes: [0, 0],
    buttons: Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}))};
}
async function fixture(mountError?: Error, filter?: RuntimeGamepadFilter) {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const realm = frame.contentWindow!;
  const target = realm.document.createElement("div"); realm.document.body.append(target);
  let pads = [pad()], focused = true, state = "RUNNING", now = 0;
  const source = vi.fn(() => filter ? filter.filter(pads as unknown as Gamepad[], now) : pads);
  Object.defineProperty(realm.navigator, "getGamepads", {configurable: true, writable: true, value: source});
  const callbacks: FrameRequestCallback[] = [];
  Object.defineProperty(realm, "requestAnimationFrame", {configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {callbacks.push(callback); return callbacks.length;})});
  Object.defineProperty(realm, "cancelAnimationFrame", {configurable: true, value: vi.fn()});
  vi.spyOn(realm.document, "hasFocus").mockImplementation(() => focused);
  const coreReads: unknown[] = [];
  const core = {
    mount: vi.fn(async () => {coreReads.push(realm.navigator.getGamepads()); if (mountError) {throw mountError;}}),
    exit: vi.fn(async () => {state = "EXITED";}), getState: () => state, setInput: vi.fn(),
    pause: vi.fn(async () => {state = "PAUSED";}), resume: vi.fn(async () => {state = "RUNNING";}),
    subscribe: () => () => undefined, acknowledgeCheckpoint: vi.fn(async () => undefined),
    checkpoint: vi.fn(async () => ({bytes: Uint8Array.of(1), format: "j2me-rms-bundle-v1"})),
    getCanvas: () => null, getFrameCount: () => 0, getCheckpointAvailability: () => ({available: true, blocker: null}),
    screenshot: vi.fn(), setVolume: vi.fn(),
  };
  const mounting = mountJ2me(config, target, realm, null, vi.fn(), vi.fn(), vi.fn(), undefined,
    async () => ({runtimeAdapter: {adapterAbi: "j2me-rms", checkpointFormat: "j2me-rms-bundle-v1", automaticViewport: true},
      createRuntime: () => core}));
  if (mountError) {await expect(mounting).rejects.toThrow(mountError.message);}
  const adapter = mountError ? null : await mounting;
  if (adapter) {disposals.push(adapter.exit);}
  return {realm, core, source, coreReads, adapter: adapter!, pad: pads[0],
    setPads: (next: ReturnType<typeof pad>[]) => {pads = next;},
    setNow: (value: number) => {now = value;},
    focus: (value: boolean) => {focused = value; realm.dispatchEvent(new Event(value ? "focus" : "blur"));},
    tick: () => callbacks.shift()?.(0)};
}

it.each([
  [0, "FIRE"], [1, "SOFT_RIGHT"], [2, "SOFT_LEFT"], [3, "DIGIT_1"],
  [4, "DIGIT_3"], [5, "DIGIT_7"], [6, "DIGIT_9"], [7, "DIGIT_0"],
  [8, "SOFT_RIGHT"], [9, "SOFT_LEFT"], [10, "STAR"], [11, "POUND"],
  [12, "UP"], [13, "DOWN"], [14, "LEFT"], [15, "RIGHT"],
] as const)("maps standard button %i to exactly one phone action %s", async (button, action) => {
  const f = await fixture();
  f.pad.buttons[button] = {pressed: true, touched: true, value: 1}; f.tick(); f.tick();
  expect(f.core.setInput.mock.calls).toEqual([[action, true]]);
  f.pad.buttons[button] = {pressed: false, touched: false, value: 0}; f.tick();
  expect(f.core.setInput.mock.calls).toEqual([[action, true], [action, false]]);
});
it("keeps the core poll empty and reads the existing frame filter without changing the Host navigator", async () => {
  const hostGetter = navigator.getGamepads;
  const f = await fixture();
  expect(f.coreReads).toEqual([[]]); expect(f.realm.navigator.getGamepads()).toEqual([]);
  expect(navigator.getGamepads).toBe(hostGetter);
  f.pad.buttons[3].pressed = true; f.tick();
  expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
  // A Host overlay suppresses the captured filter's output.
  f.setPads([]); f.tick();
  expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
  await f.adapter.exit();
  expect(f.realm.navigator.getGamepads).toBe(f.source);
});
it("deduplicates multiple controls for one action and switches the first connected standard pad without leaving keys held", async () => {
  const f = await fixture();
  f.pad.buttons[1].pressed = true; f.pad.buttons[8].pressed = true; f.tick();
  f.pad.buttons[1].pressed = false; f.tick();
  expect(f.core.setInput.mock.calls).toEqual([["SOFT_RIGHT", true]]);
  f.pad.buttons[8].pressed = false; f.pad.buttons[14].pressed = true; f.pad.axes[0] = -1; f.tick();
  f.pad.buttons[14].pressed = false; f.tick();
  expect(f.core.setInput.mock.calls).toEqual([["SOFT_RIGHT", true], ["SOFT_RIGHT", false], ["LEFT", true]]);
  const second = pad(1); second.buttons[3].pressed = true;
  f.setPads([f.pad, second]); f.tick(); expect(f.core.setInput).not.toHaveBeenCalledWith("DIGIT_1", true);
  f.pad.connected = false; f.tick();
  expect(f.core.setInput.mock.calls.slice(-2)).toEqual([["LEFT", false], ["DIGIT_1", true]]);
  second.connected = false; f.tick(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
});
it("releases on focus loss, visibility, pause and exit, and never polls after disposal", async () => {
  const f = await fixture(); f.pad.buttons[3].pressed = true; f.tick();
  f.focus(false); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
  const count = f.core.setInput.mock.calls.length; f.tick(); expect(f.core.setInput).toHaveBeenCalledTimes(count);
  f.focus(true); f.tick(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
  await f.adapter.pause(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
  f.tick(); expect(f.core.setInput).toHaveBeenCalledTimes(count + 2);
  await f.adapter.resume(); f.tick(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
  Object.defineProperty(f.realm.document, "hidden", {configurable: true, value: true});
  f.realm.document.dispatchEvent(new Event("visibilitychange"));
  expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false); f.tick();
  Object.defineProperty(f.realm.document, "hidden", {configurable: true, value: false}); f.tick();
  await f.adapter.exit(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
  const after = f.core.setInput.mock.calls.length; f.tick();
  expect(f.core.setInput).toHaveBeenCalledTimes(after); expect(f.core.exit).toHaveBeenCalledOnce();
});
it("restores the frame source when core mount fails", async () => {
  const f = await fixture(new Error("mount failed"));
  expect(f.realm.navigator.getGamepads).toBe(f.source); expect(f.core.exit).toHaveBeenCalledOnce();
});
it("releases held input throughout checkpoint export and resumes polling after success or failure", async () => {
  const f = await fixture(); f.pad.buttons[3].pressed = true; f.tick();
  f.core.checkpoint.mockImplementationOnce(async () => {
    expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
    f.tick(); expect(f.core.setInput.mock.calls).toEqual([["DIGIT_1", true], ["DIGIT_1", false]]);
    return {bytes: Uint8Array.of(2), format: "j2me-rms-bundle-v1"};
  });
  expect(await f.adapter.checkpoint()).toEqual({bytes: Uint8Array.of(2), format: "j2me-rms-bundle-v1"});
  f.tick(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
  f.core.checkpoint.mockRejectedValueOnce(new Error("checkpoint failed"));
  await expect(f.adapter.checkpoint()).rejects.toThrow("checkpoint failed");
  expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", false);
  f.tick(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
  await f.adapter.pause(); await f.adapter.checkpoint();
  const count = f.core.setInput.mock.calls.length; f.tick();
  expect(f.core.setInput).toHaveBeenCalledTimes(count);
  await f.adapter.resume(); f.tick(); expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
});
it("uses the actual Host menu filter, preserving single soft keys while reserving Start+Select chords", async () => {
  const filter = new RuntimeGamepadFilter({activeGamepadIndex: 0, suppressInput: false});
  const f = await fixture(undefined, filter);
  f.pad.buttons[8].pressed = true; f.pad.buttons[9].pressed = true; f.tick();
  f.setNow(150); f.tick(); expect(f.core.setInput).not.toHaveBeenCalled();
  f.pad.buttons[8].pressed = false; f.pad.buttons[9].pressed = false; f.setNow(170); f.tick();
  f.pad.buttons[8].pressed = true; f.setNow(900); f.tick(); f.setNow(1010); f.tick();
  expect(f.core.setInput.mock.calls).toEqual([["SOFT_RIGHT", true]]);
  filter.setPolicy({activeGamepadIndex: 0, suppressInput: true}); f.tick();
  expect(f.core.setInput).toHaveBeenLastCalledWith("SOFT_RIGHT", false);
  f.pad.buttons[8].pressed = false; f.pad.buttons[3].pressed = true; f.tick();
  expect(f.core.setInput).not.toHaveBeenCalledWith("DIGIT_1", true);
  filter.setPolicy({activeGamepadIndex: 0, suppressInput: false}); f.tick();
  expect(f.core.setInput).toHaveBeenLastCalledWith("DIGIT_1", true);
});
