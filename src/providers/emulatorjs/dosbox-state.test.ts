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

  it("copies state bytes without freeing the allocation owned by native save_state_info", () => {
    const heap = new Uint8Array(128);
    heap.set([7, 8, 9], 64);
    const free = vi.fn();
    expect(readDOSBoxPureState({
      HEAPU8: heap, UTF8ToString: () => "3|64|1", _free: free, _save_state_info: () => 24,
    })).toEqual(Uint8Array.of(7, 8, 9));
    expect(free).not.toHaveBeenCalled();
  });

  it("installs and completely removes the pinned WebAssembly hook", async () => {
    const original = window.WebAssembly.instantiate;
    const installation = installDOSBoxPureStateCompatibility(window);
    expect(window.WebAssembly.instantiate).not.toBe(original);
    await window.WebAssembly.instantiate(wasm([...linked, ...marker, ...linked]));
    installation.cleanup();
    expect(window.WebAssembly.instantiate).toBe(original);
  });

  it("uses the native state export when the new core needs no stack patch", () => {
    const heap = new Uint8Array(128);
    heap.set([7, 8, 9], 64);
    const free = vi.fn();
    class Manager {getState() {return Uint8Array.of(1);}}
    const original = Manager.prototype.getState;
    const installation = installDOSBoxPureStateCompatibility(window);
    (window as Window & {EJS_GameManager?: typeof Manager}).EJS_GameManager = Manager;
    const manager = new Manager() as Manager & {Module: object};
    manager.Module = {HEAPU8: heap, UTF8ToString: () => "3|64|1", _free: free, _save_state_info: () => 24};
    expect(manager.getState()).toEqual(Uint8Array.of(7, 8, 9));
    expect(free).not.toHaveBeenCalled();
    installation.cleanup();
    expect(Manager.prototype.getState).toBe(original);
  });

  it("waits for a native frame before probing restore serialization", async () => {
    const saveStateInfo = vi.fn(() => 24);
    const stateReady = vi.fn(() => 0);
    class Manager {toggleMainLoop = vi.fn(); FS = {unlink: vi.fn(), writeFile: vi.fn()};
      functions = {loadState: vi.fn()}; Module = {HEAPU8: new Uint8Array(128),
        UTF8ToString: () => "1|64|1", _free: vi.fn(), _save_state_info: saveStateInfo,
        _retrom_dos_state_ready: stateReady, _retrom_state_load_status: () => 0};}
    const installation = installDOSBoxPureStateCompatibility(window);
    (window as Window & {EJS_GameManager?: typeof Manager}).EJS_GameManager = Manager;
    let postMainLoop: (() => void) | undefined;
    (window as Window & {EJS_Runtime?: (config: {postMainLoop?: () => void}) => object}).EJS_Runtime =
      config => {postMainLoop = config.postMainLoop; return {};};
    (window as unknown as {EJS_Runtime: (config: object) => object}).EJS_Runtime({});
    const manager = new Manager() as Manager & {loadExplicitStateAndWait: (bytes: Uint8Array) => Promise<void>};
    const state = Uint8Array.of(...new TextEncoder().encode("RASTATE"), 1,
      ...new TextEncoder().encode("MEM "), 1, 0, 0, 0, 5);
    const restore = manager.loadExplicitStateAndWait(state);
    expect(manager.toggleMainLoop).toHaveBeenCalledExactlyOnceWith(true);
    expect(saveStateInfo).not.toHaveBeenCalled();
    postMainLoop?.();
    await vi.waitFor(() => expect(stateReady).toHaveBeenCalled());
    expect(saveStateInfo).not.toHaveBeenCalled();
    installation.cleanup();
    await expect(restore).rejects.toThrow("PLAYER_SESSION_ENDED");
  });

  it("waits for Content I/O to settle even after the native core reports state ready", async () => {
    const saveStateInfo = vi.fn(() => 24);
    const stateReady = vi.fn(() => 1);
    class Manager {toggleMainLoop = vi.fn(); FS = {unlink: vi.fn(), writeFile: vi.fn()};
      functions = {loadState: vi.fn()}; Module = {HEAPU8: new Uint8Array(128),
        UTF8ToString: () => "1|64|1", _free: vi.fn(), _save_state_info: saveStateInfo,
        _retrom_dos_state_ready: stateReady, _retrom_state_load_status: () => 0};}
    const installation = installDOSBoxPureStateCompatibility(window, () => false);
    (window as Window & {EJS_GameManager?: typeof Manager}).EJS_GameManager = Manager;
    let postMainLoop: (() => void) | undefined;
    (window as Window & {EJS_Runtime?: (config: {postMainLoop?: () => void}) => object}).EJS_Runtime =
      config => {postMainLoop = config.postMainLoop; return {};};
    (window as unknown as {EJS_Runtime: (config: object) => object}).EJS_Runtime({});
    const manager = new Manager() as Manager & {loadExplicitStateAndWait: (bytes: Uint8Array) => Promise<void>};
    const state = Uint8Array.of(...new TextEncoder().encode("RASTATE"), 1,
      ...new TextEncoder().encode("MEM "), 1, 0, 0, 0, 5);
    const restore = manager.loadExplicitStateAndWait(state);
    postMainLoop?.();
    await vi.waitFor(() => expect(manager.toggleMainLoop).toHaveBeenCalledTimes(2));
    expect(stateReady).not.toHaveBeenCalled();
    expect(saveStateInfo).not.toHaveBeenCalled();
    installation.cleanup();
    await expect(restore).rejects.toThrow("PLAYER_SESSION_ENDED");
  });

  it("restores while the native main loop keeps advancing", async () => {
    let status = 0;
    class Manager {toggleMainLoop = vi.fn(); FS = {unlink: vi.fn(), writeFile: vi.fn()};
      functions = {loadState: vi.fn()}; Module = {_retrom_dos_state_ready: () => 1,
        _retrom_state_load_status: () => status};}
    const installation = installDOSBoxPureStateCompatibility(window);
    (window as Window & {EJS_GameManager?: typeof Manager}).EJS_GameManager = Manager;
    let postMainLoop: (() => void) | undefined;
    (window as Window & {EJS_Runtime?: (config: {postMainLoop?: () => void}) => object}).EJS_Runtime =
      config => {postMainLoop = config.postMainLoop; return {};};
    (window as unknown as {EJS_Runtime: (config: object) => object}).EJS_Runtime({});
    const manager = new Manager() as Manager & {loadExplicitStateAndWait: (bytes: Uint8Array) => Promise<void>};
    const state = Uint8Array.of(...new TextEncoder().encode("RASTATE"), 1,
      ...new TextEncoder().encode("MEM "), 1, 0, 0, 0, 5);
    const restore = manager.loadExplicitStateAndWait(state);
    postMainLoop?.();
    await vi.waitFor(() => expect(manager.functions.loadState).toHaveBeenCalledWith("game.state", 0));
    expect(manager.toggleMainLoop).not.toHaveBeenCalledWith(false);
    status = 1;
    await new Promise(resolve => setTimeout(resolve, 60));
    postMainLoop?.();
    await expect(restore).resolves.toBeUndefined();
    expect(manager.toggleMainLoop).not.toHaveBeenCalledWith(false);
    installation.cleanup();
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
