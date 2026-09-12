import {expect, it} from "vitest";
import {padMask, keyboardPadMask} from "./input.js";
it("maps each standard button to exactly one engine input", () => {
  for (let button = 0; button < 16; button++) {
    const pad = {mapping: "standard" as const, connected: true, axes: [0, 0], buttons: Array.from({length: 16}, (_, i) => ({pressed: i === button, touched: i === button, value: Number(i === button)}))};
    const mask = padMask(pad);
    expect(mask & (mask - 1)).toBe(0);
    if (button === 0) {expect(mask).toBe(1);}
    if (button === 15) {expect(mask).toBe(1 << 7);}
  }
  expect(keyboardPadMask(new Set(["KeyZ", "ArrowLeft"]))).toBe(1 | (1 << 6));
});
it("releases disconnected and nonstandard controllers", () => {
  expect(padMask(null)).toBe(0);
  expect(padMask({connected: false, mapping: "standard", axes: [], buttons: []})).toBe(0);
});
