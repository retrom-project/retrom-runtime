import {describe, expect, it, vi} from "vitest";

import {EmulatorJsNetplayPort} from "./netplay-port.js";

describe("EmulatorJsNetplayPort", () => {
  it("leaves state round-trip normalization to the Host after native load completion", async () => {
    let currentState = raState([1, 2, 3]);
    const manager = {
      functions: {simulateInput: vi.fn()},
      getFrameNum: vi.fn(() => 1),
      getState: vi.fn(() => currentState),
      loadStateAndWait: vi.fn(async (state: Uint8Array) => {
        currentState = new Uint8Array(state);
        currentState[16] = currentState[16]! + 1;
        return {byteExact: false};
      }),
      runNetplayFrame: vi.fn(async () => 2),
      simulateInput: vi.fn(),
      toggleMainLoop: vi.fn(),
    };
    const port = new EmulatorJsNetplayPort({gameManager: manager}, 1_048_576, "fceumm-423-v1");

    await expect(port.loadStateAndWait(raState([4, 5, 6]), 1)).resolves.toBeUndefined();
    await expect(port.captureState(1)).resolves.toEqual(currentState);
  });
});

function raState(core: number[]) {
  const state = new Uint8Array(32);
  state.set(new TextEncoder().encode("RASTATE"));
  state[7] = 1;
  state.set(new TextEncoder().encode("MEM "), 8);
  new DataView(state.buffer).setUint32(12, core.length, true);
  state.set(core, 16);
  state.set(new TextEncoder().encode("END "), 24);
  return state;
}
