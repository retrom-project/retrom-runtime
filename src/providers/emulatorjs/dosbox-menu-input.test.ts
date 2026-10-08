import {expect, it, vi} from "vitest";
import {installDOSMenuInput} from "./dosbox-menu-input.js";

function fixture() {
  const parent = document.createElement("div"), canvas = document.createElement("canvas"), input = document.createElement("input");
  parent.append(canvas, input); document.body.append(parent);
  const state = {ready: 0}, simulateInput = vi.fn();
  const instance = {canvas, paused: false, gameManager: {simulateInput, Module: {_retrom_dos_state_ready: () => state.ready}}};
  const cleanup = installDOSMenuInput(window, instance);
  const key = (type: "keydown" | "keyup", name: string, repeat = false, target: HTMLElement = parent) => {
    const event = new KeyboardEvent(type, {key: name, code: name, repeat, bubbles: true, cancelable: true});
    target.dispatchEvent(event); return event;
  };
  return {key, state, instance, simulateInput, input, dispose: () => {cleanup(); parent.remove();}};
}

it("delivers menu arrows and confirmation exactly once before the native keyboard handler", () => {
  const f = fixture(), native = vi.fn(); document.addEventListener("keydown", native);
  try {
    expect(f.key("keydown", "ArrowDown").defaultPrevented).toBe(true);
    f.key("keydown", "ArrowDown", true); f.key("keyup", "ArrowDown");
    f.key("keydown", "Enter"); f.state.ready = 1; f.key("keyup", "Enter");
    expect(f.simulateInput.mock.calls).toEqual([[0, 5, 1], [0, 5, 0], [0, 3, 1], [0, 3, 0]]);
    expect(native).not.toHaveBeenCalled();
  } finally {document.removeEventListener("keydown", native); f.dispose();}
});

it("leaves actual program keyboard input, paused frames and editable controls untouched", () => {
  const f = fixture(), native = vi.fn(); document.addEventListener("keydown", native);
  try {
    f.state.ready = 1; expect(f.key("keydown", "ArrowDown").defaultPrevented).toBe(false);
    f.state.ready = 0; f.instance.paused = true; f.key("keydown", "Enter");
    f.instance.paused = false; f.key("keydown", "j", false, f.input);
    expect(native).toHaveBeenCalledTimes(3); expect(f.simulateInput).not.toHaveBeenCalled();
  } finally {document.removeEventListener("keydown", native); f.dispose();}
});

it("releases aliased held controls on blur and removes every listener on disposal", () => {
  const f = fixture();
  f.key("keydown", "w"); f.key("keydown", "ArrowUp"); f.key("keyup", "w");
  expect(f.simulateInput.mock.calls).toEqual([[0, 4, 1]]);
  window.dispatchEvent(new Event("blur"));
  expect(f.simulateInput.mock.calls).toEqual([[0, 4, 1], [0, 4, 0]]);
  f.key("keydown", "k"); f.dispose();
  expect(f.simulateInput.mock.calls).toEqual([[0, 4, 1], [0, 4, 0], [0, 8, 1], [0, 8, 0]]);
  f.key("keydown", "s"); expect(f.simulateInput).toHaveBeenCalledTimes(4);
});
