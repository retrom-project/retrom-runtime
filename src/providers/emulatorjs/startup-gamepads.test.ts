import {expect, it, vi} from "vitest";

import {initializeEmulatorJsGamepads} from "./startup-gamepads.js";

it("fills free players without duplicating or replacing existing gamepad assignments", () => {
  const instance = {
    gamepad: {gamepads: [{id: "Pad", index: 0}, {id: "Pad", index: 1}, {id: "Pad", index: 2}]},
    gamepadSelection: ["", "Pad_0", "", ""],
    updateGamepadLabels: vi.fn(),
  };
  initializeEmulatorJsGamepads(instance);
  expect(instance.gamepadSelection).toEqual(["Pad_1", "Pad_0", "Pad_2", ""]);
  initializeEmulatorJsGamepads(instance);
  expect(instance.updateGamepadLabels).toHaveBeenCalledOnce();
});

it("leaves full player assignments and a runtime without detected gamepads alone", () => {
  const instance = {
    gamepad: {gamepads: [{id: "Extra pad", index: 4}]},
    gamepadSelection: ["Pad_0", "Pad_1", "Pad_2", "Pad_3"],
    updateGamepadLabels: vi.fn(),
  };
  initializeEmulatorJsGamepads(instance);
  expect(instance.gamepadSelection).toEqual(["Pad_0", "Pad_1", "Pad_2", "Pad_3"]);
  expect(instance.updateGamepadLabels).not.toHaveBeenCalled();
  expect(() => initializeEmulatorJsGamepads({})).not.toThrow();
});

it("delivers a nonzero browser gamepad index to EmulatorJS's compact gamepad list", () => {
  const delivered: string[] = [];
  type PadEvent = {gamepadIndex: number; [key: string]: unknown};
  const listeners: Record<string, (event: PadEvent) => void> = {
    buttondown: event => {
      delivered.push(`${gamepad.gamepads[event.gamepadIndex].id}:${event.label}`);
    },
    connected: event => {
      delivered.push(gamepad.gamepads[event.gamepadIndex].id);
    },
  };
  const gamepad = {
    gamepads: [{id: "Xbox 360 Controller", index: 1}],
    listeners,
  };
  const instance = {gamepad, gamepadSelection: ["", "", "", ""], updateGamepadLabels: vi.fn()};
  initializeEmulatorJsGamepads(instance);
  expect(instance.gamepadSelection[0]).toBe("Xbox 360 Controller_1");
  expect(() => gamepad.listeners.buttondown({gamepadIndex: 1, label: "START"})).not.toThrow();
  expect(delivered).toEqual(["Xbox 360 Controller:START"]);
});

it("assigns a late connected pad with a sparse browser index and restores handlers on exit", () => {
  const gamepad = {
    gamepads: [] as {id: string; index: number}[],
    listeners: {} as Record<string, (event: {gamepadIndex: number}) => void>,
  };
  const selection = ["", "", "", ""];
  const connected = (event: {gamepadIndex: number}) => {
    const pad = gamepad.gamepads[event.gamepadIndex];
    selection[0] = `${pad.id}_${pad.index}`;
  };
  gamepad.listeners.connected = connected;
  const cleanup = initializeEmulatorJsGamepads({gamepad, gamepadSelection: selection});
  gamepad.gamepads.push({id: "Xbox 360 Controller", index: 3});
  gamepad.listeners.connected({gamepadIndex: 3});
  expect(selection[0]).toBe("Xbox 360 Controller_3");
  cleanup();
  expect(gamepad.listeners.connected).toBe(connected);
});

it("lets the first actively used gamepad claim player one without moving a committed player", () => {
  const selection = ["Idle pad_0", "Xbox 360 Controller_1", "", ""];
  const delivered: string[] = [];
  const gamepad = {
    gamepads: [{id: "Idle pad", index: 0}, {id: "Xbox 360 Controller", index: 1}],
    listeners: {} as Record<string, (event: {gamepadIndex: number; label?: unknown}) => void>,
  };
  gamepad.listeners.buttondown = event => {
    const pad = gamepad.gamepads[event.gamepadIndex];
    delivered.push(`${selection.indexOf(`${pad.id}_${pad.index}`)}:${event.label}`);
  };
  const updateGamepadLabels = vi.fn();
  initializeEmulatorJsGamepads({gamepad, gamepadSelection: selection, updateGamepadLabels});
  gamepad.listeners.buttondown({gamepadIndex: 1, label: "START"});
  expect(selection.slice(0, 2)).toEqual(["Xbox 360 Controller_1", "Idle pad_0"]);
  expect(delivered).toEqual(["0:START"]);
  expect(updateGamepadLabels).toHaveBeenCalledOnce();
  gamepad.listeners.buttondown({gamepadIndex: 0, label: "BUTTON_2"});
  expect(selection.slice(0, 2)).toEqual(["Xbox 360 Controller_1", "Idle pad_0"]);
  expect(delivered).toEqual(["0:START", "1:BUTTON_2"]);
});
