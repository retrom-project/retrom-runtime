import {describe, expect, it, vi} from "vitest";
import {gamepadKeys, updateKeys} from "./input.js";
describe("PC-98 standard gamepad", () => {
  it("assigns exactly one PC-98 input to each mapped button", () => {
    for (const [button, expected] of [[0, 0x34], [1, 0], [2, 0x29], [3, 0x2a], [9, 0x1c],
      [12, 0x3a], [13, 0x3d], [14, 0x3b], [15, 0x3c]]) {
      const pad = {mapping: "standard" as const, connected: true, axes: [0, 0],
        buttons: Array.from({length: 17}, (_, index) => ({pressed: index === button, value: index === button ? 1 : 0, touched: false}))};
      const keys = gamepadKeys([pad]); expect([...keys]).toEqual([expected]);
      const send = vi.fn(); updateKeys(new Set(), keys, send); updateKeys(keys, gamepadKeys([pad]), send);
      expect(send.mock.calls).toEqual([[expected, 1]]);
    }
  });
  it("maps directions, confirmation and cancellation and releases disconnected controls", () => {
    const pad = {mapping: "standard" as const, connected: true, axes: [-1, 0], buttons: Array.from({length: 16}, (_, i) => ({pressed: i === 0 || i === 1, value: 0, touched: false}))};
    const keys = gamepadKeys([pad]); expect(keys.has(0x3b)).toBe(true);
    expect(keys.has(0x34)).toBe(true); expect(keys.has(0x00)).toBe(true);
    const send = vi.fn(); updateKeys(keys, new Set(), send);
    expect(send).toHaveBeenCalledWith(0x3b, 0); expect(send).toHaveBeenCalledWith(0x34, 0);
  });
});

it("keeps held buttons released while the frame is blurred, then clears on exit", async () => {
  const {installGamepad} = await import("./input.js");
  let next: FrameRequestCallback = () => undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {next = callback; return 1;});
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  Object.defineProperty(navigator, "getGamepads", {configurable: true, value: () => [{connected: true, mapping: "standard", axes: [], buttons: [{pressed: true}]}]});
  const send = vi.fn(), controls = installGamepad(window, send);
  try {
    next(0); expect(send).toHaveBeenLastCalledWith(0x34, 1);
    window.dispatchEvent(new Event("blur")); expect(send).toHaveBeenLastCalledWith(0x34, 0);
    send.mockClear(); next(16); expect(send).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus")); next(32); expect(send).toHaveBeenLastCalledWith(0x34, 1);
    controls.stop(); expect(send).toHaveBeenLastCalledWith(0x34, 0); expect(cancel).toHaveBeenCalledWith(1);
  } finally {controls.stop(); raf.mockRestore(); cancel.mockRestore(); Reflect.deleteProperty(navigator, "getGamepads");}
});
