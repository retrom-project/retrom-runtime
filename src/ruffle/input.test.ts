import {afterEach, expect, it, vi} from "vitest";
import {installRuffleGamepad} from "./input.js";

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
  const input = installRuffleGamepad(window, canvas);
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
