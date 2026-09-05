import {afterEach, describe, expect, it, vi} from "vitest";

import {
  installDOSBoxPureStateCompatibility,
  patchDOSBoxPureStateStack,
  readDOSBoxPureState,
} from "./dosbox-state.js";

const marker = [
  0x23, 0x0c, 0x45, 0x04, 0x40, 0x20, 0x01, 0x41, 0xc0, 0x02,
  0x6a, 0x24, 0x00, 0x20, 0x01, 0x41, 0x10, 0x6a, 0x0f,
];
const linked = [0xf0, 0xec, 0x80, 0x0e];
const compatible = [0xf0, 0xec, 0x80, 0x2c];

afterEach(() => {
  Reflect.deleteProperty(window, "EJS_GameManager");
  Reflect.deleteProperty(window, "EJS_Runtime");
});

describe("DOSBox Pure state compatibility", () => {
  it("patches exactly two linked stack limits in the pinned WASM shape", () => {
    const source = wasm([...linked, ...marker, ...linked]);
    const patched = patchDOSBoxPureStateStack(source);
    expect(patched).not.toBeNull();
    expect(WebAssembly.validate(patched!)).toBe(true);
    expect(count(patched!, linked)).toBe(0);
    expect(count(patched!, compatible)).toBe(2);
    expect(patchDOSBoxPureStateStack(wasm([1, 2, 3]))).toBeNull();
    expect(() => patchDOSBoxPureStateStack(wasm([...marker, ...linked])))
      .toThrow("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");
  });

  it("copies state bytes and frees only the heap allocation", () => {
    const heap = new Uint8Array(128);
    heap.set([7, 8, 9], 64);
    const free = vi.fn();
    expect(readDOSBoxPureState({
      HEAPU8: heap, UTF8ToString: () => "3|64|1", _free: free, _save_state_info: () => 24,
    })).toEqual(Uint8Array.of(7, 8, 9));
    expect(free).toHaveBeenCalledExactlyOnceWith(64);
  });

  it("installs and completely removes the pinned WebAssembly hook", async () => {
    const original = window.WebAssembly.instantiate;
    const installation = installDOSBoxPureStateCompatibility(window);
    expect(window.WebAssembly.instantiate).not.toBe(original);
    await window.WebAssembly.instantiate(wasm([...linked, ...marker, ...linked]));
    installation.cleanup();
    expect(window.WebAssembly.instantiate).toBe(original);
  });
});

function wasm(payload: number[]) {
  const section = [1, 0x78, ...payload];
  return Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 0, section.length, ...section);
}
function count(bytes: Uint8Array, pattern: number[]) {
  let result = 0;
  for (let index = 0; index <= bytes.byteLength - pattern.length; index += 1) {
    if (pattern.every((value, offset) => bytes[index + offset] === value)) {result += 1;}
  }
  return result;
}
