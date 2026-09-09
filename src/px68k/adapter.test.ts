import {afterEach, expect, it, vi} from "vitest";
import {mountPx68k} from "./adapter.js";
import {decodeCheckpoint, encodeCheckpoint} from "./state.js";
import {px68kFixture} from "../../tests/px68k-adapter-fixture.js";
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
it("sends standard Button 1 as joypad B without injecting Escape, and keeps keyboard input independent", async () => {
  const f = px68kFixture();
  const buttons = Array.from({length: 16}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {connected: true, mapping: "standard", buttons, axes: []};
  vi.stubGlobal("navigator", {getGamepads: () => [pad]});
  const player = await mountPx68k(f.config, f.target, window, null, vi.fn(), vi.fn(), undefined, f.loader);
  buttons[1]!.pressed = true; f.frame(100);
  expect(f.core._retrom_step).toHaveBeenLastCalledWith(1, 0);
  expect(f.core._retrom_key).not.toHaveBeenCalledWith(27, 1);
  buttons[1]!.pressed = false; buttons[0]!.pressed = true; f.frame(120);
  expect(f.core._retrom_step).toHaveBeenLastCalledWith(1 << 8, 0);
  expect(f.core._retrom_key).not.toHaveBeenCalledWith(13, 1);
  for (const [code, key, native] of [["Escape", "Escape", 27], ["Enter", "Enter", 13], ["ArrowLeft", "ArrowLeft", 276], ["KeyZ", "z", 122]] as const) {
    window.dispatchEvent(new KeyboardEvent("keydown", {code, key}));
    expect(f.core._retrom_key).toHaveBeenLastCalledWith(native, 1);
    window.dispatchEvent(new KeyboardEvent("keyup", {code, key}));
    expect(f.core._retrom_key).toHaveBeenLastCalledWith(native, 0);
  }
  pad.connected = false; f.frame(140);
  expect(f.core._retrom_step).toHaveBeenLastCalledWith(0, 0);
  await player.exit();
});
it("steps frames, forwards keyboard releases, pauses and exits without further execution", async () => {
  const f = px68kFixture(), failure = vi.fn();
  const player = await mountPx68k(f.config, f.target, window, null, vi.fn(), failure, undefined, f.loader);
  f.frame(100); expect(player.getFrameCount?.()).toBe(1);
  window.dispatchEvent(new KeyboardEvent("keydown", {key: "z", code: "KeyZ"}));
  expect(f.core._retrom_key).toHaveBeenCalledWith(122, 1);
  window.dispatchEvent(new Event("blur")); expect(f.core._retrom_key).toHaveBeenCalledWith(122, 0);
  await player.pause?.(); f.frame(200); expect(player.getFrameCount?.()).toBe(1);
  await player.resume?.(); f.frame(300); expect(player.getFrameCount?.()).toBe(2);
  const state = await player.checkpoint(); const parsed = decodeCheckpoint(f.config.game.sha256, state.bytes);
  expect(parsed.state).toEqual(new Uint8Array([9, 8, 7, 6])); expect(parsed.frames).toBe(2);
  await player.exit(); f.frame(400); expect(f.core._retrom_stop).toHaveBeenCalledOnce();
  expect(f.target.children).toHaveLength(0); expect(failure).not.toHaveBeenCalled();
});
it("maps each standard gamepad button to one native joypad input without any keyboard events", async () => {
  const f = px68kFixture();
  const buttons = Array.from({length: 16}, () => ({pressed: false, touched: false, value: 0}));
  vi.stubGlobal("navigator", {getGamepads: () => [{connected: true, mapping: "standard", buttons, axes: []}]});
  const player = await mountPx68k(f.config, f.target, window, null, vi.fn(), vi.fn(), undefined, f.loader);
  for (let index = 0; index < buttons.length; index++) {
    buttons[index]!.pressed = true; f.frame(100 + index * 40);
    const [mask, second] = vi.mocked(f.core._retrom_step).mock.lastCall!;
    expect(mask).toBeGreaterThan(0); expect(mask & (mask - 1)).toBe(0); expect(second).toBe(0);
    buttons[index]!.pressed = false; f.frame(120 + index * 40);
    expect(f.core._retrom_step).toHaveBeenLastCalledWith(0, 0);
  }
  expect(f.core._retrom_key).not.toHaveBeenCalled();
  await player.exit();
});
it("lets keyboard arrows and Z/X operate joypad one and releases them on blur and pause", async () => {
  const f = px68kFixture();
  const player = await mountPx68k(f.config, f.target, window, null, vi.fn(), vi.fn(), undefined, f.loader);
  window.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", code: "ArrowLeft"}));
  window.dispatchEvent(new KeyboardEvent("keydown", {key: "z", code: "KeyZ"}));
  f.frame(100);
  expect(f.core._retrom_step).toHaveBeenLastCalledWith((1 << 6) | (1 << 8), 0);
  window.dispatchEvent(new KeyboardEvent("keyup", {key: "z", code: "KeyZ"}));
  window.dispatchEvent(new KeyboardEvent("keydown", {key: "x", code: "KeyX"}));
  f.frame(120); expect(f.core._retrom_step).toHaveBeenLastCalledWith((1 << 6) | 1, 0);
  window.dispatchEvent(new Event("blur")); f.frame(140);
  expect(f.core._retrom_step).toHaveBeenLastCalledWith(0, 0);
  window.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", code: "ArrowRight"}));
  await player.pause?.(); await player.resume?.(); f.frame(160);
  expect(f.core._retrom_step).toHaveBeenLastCalledWith(0, 0);
  await player.exit();
});
it("restores disk bytes before boot and machine state afterward in a fresh instance", async () => {
  const f = px68kFixture();
  const saved = encodeCheckpoint(f.config.game.sha256, new Uint8Array([5, 4]), {"disk0.dim": new Uint8Array([8])}, 90);
  vi.mocked(f.core._retrom_load).mockImplementation(() => {
    expect(f.files.get("/game/disk0.dim")).toEqual(new Uint8Array([8])); return 1;
  });
  vi.mocked(f.core._retrom_restore).mockImplementation((pointer, size) => {
    expect(f.core.HEAPU8.slice(pointer, pointer + size)).toEqual(new Uint8Array([5, 4])); return 1;
  });
  const player = await mountPx68k(f.config, f.target, window, saved, vi.fn(), vi.fn(), undefined, f.loader);
  expect(player.getFrameCount?.()).toBe(90); f.frame(100); expect(player.getFrameCount?.()).toBe(91);
  await player.exit();
});
it("cleans up a native load failure", async () => {
  const f = px68kFixture(); vi.mocked(f.core._retrom_load).mockReturnValue(0);
  await expect(mountPx68k(f.config, f.target, window, null, vi.fn(), vi.fn(), undefined, f.loader)).rejects.toThrow("PX68K_DISK_INVALID");
  expect(f.core._retrom_stop).toHaveBeenCalledOnce(); expect(f.target.children).toHaveLength(0);
});
it("cleans up if cancellation arrives during module construction", async () => {
  const f = px68kFixture(), controller = new AbortController();
  const loader = async () => ({default: async () => {controller.abort(); return f.core;}});
  await expect(mountPx68k(f.config, f.target, window, null, vi.fn(), vi.fn(), controller.signal, loader)).rejects.toThrow();
  expect(f.core._retrom_stop).toHaveBeenCalledOnce(); expect(f.target.children).toHaveLength(0);
});
