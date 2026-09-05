import {describe, expect, it} from "vitest";

import {canonicalizeEmulatorJsNetplayState, coreStateBytes} from "./netplay-state.js";

describe("EmulatorJS netplay state canonicalization", () => {
  it("zeros Nestopia tracked input bytes inside the provider-owned checkpoint", () => {
    const core = new Uint8Array(64);
    core.set([0x4e, 0x53, 0x54, 0x1a]);
    new DataView(core.buffer).setUint32(4, 32, true);
    core.set([0x4e, 0x46, 0x4f, 0x00], 8);
    new DataView(core.buffer).setUint32(12, 8, true);
    core.set([1, 2, 3, 4, 5, 6, 7, 8], 40);

    const state = raState(core);
    const canonical = canonicalizeEmulatorJsNetplayState(state, "nestopia-423-v1");

    expect([...coreStateBytes(canonical).subarray(40, 48)]).toEqual(Array(8).fill(0));
    expect([...coreStateBytes(state).subarray(40, 48)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

function raState(core: Uint8Array) {
  const padded = (core.byteLength + 7) & ~7;
  const state = new Uint8Array(8 + 8 + padded + 8);
  state.set(new TextEncoder().encode("RASTATE"));
  state[7] = 1;
  state.set(new TextEncoder().encode("MEM "), 8);
  new DataView(state.buffer).setUint32(12, core.byteLength, true);
  state.set(core, 16);
  state.set(new TextEncoder().encode("END "), 16 + padded);
  return state;
}
