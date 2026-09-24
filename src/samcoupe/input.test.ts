import {expect, it, vi} from "vitest";
import {installSamGamepad, samGamepadKeys} from "./input.js";

it("maps standard directions and one confirm key per button", () => {
  const buttons = Array.from({length: 16}, (_, index) => ({pressed: index === 0 || index === 14, value: index === 0 || index === 14 ? 1 : 0}));
  const pad = {connected: true, mapping: "standard", axes: [0, -0.7], buttons} as unknown as Gamepad;
  expect(samGamepadKeys(pad)).toEqual(new Set(["ArrowUp", "ArrowLeft", "Enter"]));
  expect(samGamepadKeys({...pad, mapping: ""})).toEqual(new Set());
});

it("lets an active gamepad at index one control Sam when index zero is idle", () => {
  const idle = {index: 0, connected: true, mapping: "standard", axes: [0, 0, -0.4, 0],
    buttons: Array.from({length: 16}, () => ({pressed: false, value: 0}))};
  const active = {index: 1, connected: true, mapping: "standard", axes: [0, 0, 0, 0],
    buttons: Array.from({length: 16}, (_, index) => ({pressed: index === 0, value: index === 0 ? 1 : 0}))};
  let poll: FrameRequestCallback = () => undefined;
  const runtimeWindow = {navigator: {getGamepads: () => [idle, active]}, document: {hidden: false},
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {poll = callback; return 1;}),
    cancelAnimationFrame: vi.fn()} as unknown as Window;
  const gameWindow = {KeyboardEvent: class {
    constructor(public type: string, public init: KeyboardEventInit) {}
  }} as unknown as Window;
  const dispatchEvent = vi.fn();
  const canvas = {dispatchEvent} as unknown as HTMLCanvasElement;
  const installed = installSamGamepad(runtimeWindow, gameWindow, canvas);
  poll(0);
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({type: "keydown", init: expect.objectContaining({key: "Enter"})}));
  active.buttons[0] = {pressed: false, value: 0};
  poll(1);
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({type: "keyup", init: expect.objectContaining({key: "Enter"})}));
  installed.dispose();
});
