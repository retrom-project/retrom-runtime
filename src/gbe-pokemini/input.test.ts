import {expect, it, vi} from "vitest";
import {gamepadKeys, installInput} from "./input.js";
const pad = (button: number) => ({connected: true, mapping: "standard" as const, axes: [0, 0],
  buttons: Array.from({length: 16}, (_, i) => ({pressed: i === button, value: i === button ? 1 : 0, touched: false}))});
it("maps each standard button to exactly one Pokémon Mini input", () => {
  for (const [button, key] of [[0, 4], [1, 5], [2, 6], [4, 7], [8, 8], [12, 0], [13, 1], [14, 2], [15, 3]]) {
    expect([...gamepadKeys([pad(button)])]).toEqual([key]);
  }
  expect([...gamepadKeys([pad(9)])]).toEqual([]);
  expect([...gamepadKeys([{...pad(0), mapping: ""}])]).toEqual([]);
});
it("merges keyboard and pad holds and releases them on pause, blur and exit", () => {
  let tick: FrameRequestCallback = () => undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {tick = callback; return 1;});
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  let pads = [pad(0)];
  const original = Object.getOwnPropertyDescriptor(window.navigator, "getGamepads");
  Object.defineProperty(window.navigator, "getGamepads", {configurable: true, value: () => pads});
  const send = vi.fn(), input = installInput(window, send);
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyZ"})); tick(0);
    expect(send.mock.calls).toEqual([[4, 1]]);
    pads = []; tick(1); expect(send).toHaveBeenCalledTimes(1);
    input.pause(true); expect(send.mock.calls.at(-1)).toEqual([4, 0]);
    input.pause(false); tick(2); expect(send).toHaveBeenCalledTimes(2);
    pads = [pad(13)]; tick(3); expect(send.mock.calls.at(-1)).toEqual([1, 1]);
    window.dispatchEvent(new Event("blur")); tick(4);
    expect(send.mock.calls.at(-1)).toEqual([1, 0]);
    window.dispatchEvent(new Event("focus")); tick(5);
    expect(send.mock.calls.at(-1)).toEqual([1, 1]);
    input.stop(); const count = send.mock.calls.length;
    window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyX"})); tick(6);
    expect(send).toHaveBeenCalledTimes(count); expect(send.mock.calls.at(-1)).toEqual([1, 0]);
  } finally {input.stop(); raf.mockRestore(); cancel.mockRestore(); if (original) {Object.defineProperty(window.navigator, "getGamepads", original);}
    else {Reflect.deleteProperty(window.navigator, "getGamepads");}}
});
