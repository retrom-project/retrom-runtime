import {afterEach, expect, it, vi} from "vitest";
import {installWebMSXGamepad} from "./input.js";

afterEach(() => vi.restoreAllMocks());
it("maps a standard pad at a sparse index and releases on disconnect, pause and exit", () => {
  let tick: FrameRequestCallback = () => undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {tick = callback; return 1;});
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  const pad = {connected: true, mapping: "standard", axes: [0, 0],
    buttons: Array.from({length: 16}, () => ({pressed: false, value: 0}))};
  Object.defineProperty(window.navigator, "getGamepads", {configurable: true, value: () => [null, pad]});
  const canvas = document.createElement("canvas"); const events: string[] = [];
  for (const name of ["keydown", "keyup"]) {canvas.addEventListener(name, (event) => events.push(`${name}:${(event as KeyboardEvent).code}`));}
  const input = installWebMSXGamepad(window, canvas);
  pad.axes[0] = 1; pad.buttons[0].pressed = true; pad.buttons[1].pressed = true;
  tick(0);
  expect(events).toEqual(["keydown:ArrowRight", "keydown:Space", "keydown:Escape"]);
  pad.connected = false; tick(1);
  expect(events.slice(3)).toEqual(["keyup:ArrowRight", "keyup:Space", "keyup:Escape"]);
  pad.connected = true; tick(2); input.pause();
  expect(events.slice(-3)).toEqual(["keyup:ArrowRight", "keyup:Space", "keyup:Escape"]);
  const length = events.length; tick(3); expect(events).toHaveLength(length);
  input.resume(); tick(4); input.dispose();
  expect(events.slice(-3)).toEqual(["keyup:ArrowRight", "keyup:Space", "keyup:Escape"]);
  expect(cancel).toHaveBeenCalled();
});

it.each([[0, "Space"], [1, "Escape"], [2, "KeyX"], [3, "Enter"], [9, "Enter"],
  [12, "ArrowUp"], [13, "ArrowDown"], [14, "ArrowLeft"], [15, "ArrowRight"]])(
  "button %i emits exactly one target key %s without a parallel native-controller path", (index, key) => {
    let tick: FrameRequestCallback = () => undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {tick = callback; return 1;});
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const buttons = Array.from({length: 16}, () => ({pressed: false, value: 0}));
    buttons[index as number].pressed = true;
    Object.defineProperty(window.navigator, "getGamepads", {configurable: true,
      value: () => [{connected: true, mapping: "standard", axes: [0, 0], buttons}]});
    const canvas = document.createElement("canvas"); const events: string[] = [];
    canvas.addEventListener("keydown", (event) => events.push(event.code));
    const input = installWebMSXGamepad(window, canvas);
    tick(0); tick(1);
    expect(events).toEqual([key]);
    input.dispose();
    canvas.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyQ"}));
    expect(events).toEqual([key, "KeyQ"]);
  });
