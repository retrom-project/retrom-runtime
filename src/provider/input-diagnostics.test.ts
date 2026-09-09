import {afterEach, expect, it, vi} from "vitest";
import {startInputDiagnostics} from "./input-diagnostics.js";
import {installRuntimeGamepadFilter, RuntimeGamepadFilter} from "./gamepad-filter.js";

afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});

it("observes short keyboard presses without cancelling, refocusing or synthesizing input", () => {
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  const focus = vi.spyOn(canvas, "focus");
  const received = vi.fn(); canvas.addEventListener("keydown", received);
  const session = startInputDiagnostics(window, () => canvas);
  const down = new KeyboardEvent("keydown", {code: "Enter", bubbles: true, cancelable: true});
  canvas.dispatchEvent(down);
  canvas.dispatchEvent(new KeyboardEvent("keyup", {code: "Enter", bubbles: true}));
  const snapshot = session.read();
  expect(snapshot.events.filter((event) => event.stage === "DELIVERED").map((event) => event.value)).toEqual([1, 0]);
  expect(snapshot.events[3].heldMs).toBeGreaterThanOrEqual(0);
  expect(snapshot.held).toEqual([]);
  expect(down.defaultPrevented).toBe(false);
  expect(received).toHaveBeenCalledOnce(); expect(focus).not.toHaveBeenCalled();
  session.stop(); canvas.dispatchEvent(down);
  expect(session.read().events).toHaveLength(4);
});

it("does not poll gamepads or advance a filter and restores the exact getter on stop", () => {
  const buttons = [{pressed: false, touched: false, value: 0}];
  const pads = [{index: 0, connected: true, mapping: "standard", buttons, axes: [0, 0], id: "fixture", timestamp: 0, vibrationActuator: {} as GamepadHapticActuator}] satisfies Gamepad[];
  const getter = vi.fn(() => pads);
  Object.defineProperty(navigator, "getGamepads", {configurable: true, writable: true, value: getter});
  const session = startInputDiagnostics(window, () => null);
  expect(getter).not.toHaveBeenCalled(); session.read(); expect(getter).not.toHaveBeenCalled();
  expect(navigator.getGamepads()).toBe(pads);
  buttons[0] = {pressed: true, touched: true, value: 1}; navigator.getGamepads();
  buttons[0] = {pressed: false, touched: false, value: 0}; navigator.getGamepads();
  expect(getter).toHaveBeenCalledTimes(3);
  expect(session.read().events.map((event) => event.value)).toEqual([1, 0]);
  session.stop(); session.stop();
  expect(navigator.getGamepads).toBe(getter);
  Reflect.deleteProperty(navigator, "getGamepads");
});

it("bounds history and clears diagnostic held state on blur without releasing game inputs", () => {
  const session = startInputDiagnostics(window, () => null);
  const releases = vi.fn(); window.addEventListener("keyup", releases);
  for (let index = 0; index < 100; index++) {
    window.dispatchEvent(new KeyboardEvent(index % 2 ? "keyup" : "keydown", {code: "KeyZ"}));
  }
  expect(session.read().events).toHaveLength(64);
  window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyX"}));
  const calls = releases.mock.calls.length;
  window.dispatchEvent(new Event("blur"));
  expect(session.read().held).toEqual([]); expect(releases).toHaveBeenCalledTimes(calls);
  session.stop(); window.removeEventListener("keyup", releases);
});

it("preserves the filter's delayed Select edge and never evaluates the filter twice", () => {
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  const buttons = Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {index: 0, connected: true, mapping: "standard", id: "fixture", timestamp: 0, buttons, axes: []};
  const native = vi.fn(() => [pad]);
  Object.defineProperty(navigator, "getGamepads", {configurable: true, value: native});
  const filter = new RuntimeGamepadFilter({activeGamepadIndex: 0, suppressInput: false});
  const evaluate = vi.spyOn(filter, "filter");
  const removeFilter = installRuntimeGamepadFilter(window, filter);
  const filtered = navigator.getGamepads;
  const session = startInputDiagnostics(window, () => null);
  const result: boolean[] = [];
  for (const [at, pressed] of [[0, false], [10, true], [40, false], [41, false]] as const) {
    time = at; buttons[8] = {pressed, touched: pressed, value: pressed ? 1 : 0};
    result.push(navigator.getGamepads()[0]!.buttons[8].pressed);
    session.read();
  }
  expect(result).toEqual([false, false, true, false]);
  expect(evaluate).toHaveBeenCalledTimes(4); expect(native).toHaveBeenCalledTimes(4);
  expect(session.read().events.some((event) => event.reason === "INPUT_FILTER")).toBe(true);
  session.stop(); expect(navigator.getGamepads).toBe(filtered);
  removeFilter(); expect(navigator.getGamepads).toBe(native);
  Reflect.deleteProperty(navigator, "getGamepads");
});

it("does not claim delivery when propagation stops before the game surface", () => {
  const wrapper = document.createElement("div");
  const canvas = document.createElement("canvas"); wrapper.append(canvas); document.body.append(wrapper);
  wrapper.addEventListener("keydown", (event) => event.stopPropagation(), {capture: true});
  const session = startInputDiagnostics(window, () => canvas);
  canvas.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyK", bubbles: true}));
  expect(session.read().events.map((event) => event.stage)).toEqual(["BROWSER"]);
  session.stop();
});
