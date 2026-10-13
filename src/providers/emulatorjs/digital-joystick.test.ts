import {afterEach, expect, it, vi} from "vitest";
import {installDigitalJoysticks} from "./digital-joystick.js";

type Info = {angle: {degree: number}; distance: number};
type Listener = (event: unknown, info: Info) => void;
class Collection {
  listeners = new Map<string, Set<Listener>>();
  on(name: string, listener: Listener) {
    if (!this.listeners.has(name)) {this.listeners.set(name, new Set());}
    this.listeners.get(name)!.add(listener); return this;
  }
  off(name: string, listener: Listener) {this.listeners.get(name)?.delete(listener); return this;}
  emit(name: string, degree = 0, distance = 30) {
    for (const listener of this.listeners.get(name) ?? []) {listener({}, {angle: {degree}, distance});}
  }
}

let dispose = () => {};
afterEach(() => {dispose(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();});

function setup(custom?: {id: string; joystickInput: boolean; inputValues: number[]}, beforeVendorLoad = false) {
  vi.useFakeTimers();
  const state = new Map<number, number>();
  const send = vi.fn((_player: number, control: number, value: number) => {state.set(control, value);});
  const instance = {gameManager: {simulateInput: send}, paused: false};
  const nipplejs = {create: (_options: {zone: HTMLElement}) => new Collection()};
  const create = nipplejs.create;
  const host = Object.assign(window, {nipplejs: beforeVendorLoad ? undefined : nipplejs});
  const controls = custom ? [{...custom, type: "zone" as const, location: "left" as const}] : undefined;
  const runtimeWindow = Object.assign(host, {EJS_VirtualGamepadSettings: controls});
  const adapter = installDigitalJoysticks(runtimeWindow);
  if (beforeVendorLoad) {host.nipplejs = nipplejs;}
  dispose = () => {adapter.dispose(); Reflect.deleteProperty(window, "nipplejs"); Reflect.deleteProperty(window, "EJS_VirtualGamepadSettings"); Reflect.deleteProperty(window, "EJS_emulator");};
  const zone = document.createElement("div"); zone.className = `b_${custom?.id ?? "dpad"}`; document.body.append(zone);
  const stick = nipplejs.create({zone});
  const values = custom?.inputValues ?? [4, 5, 6, 7];
  const legacyMove = vi.fn((_event: unknown, info: Info) => {
    // The pinned EJS digital-zone lifecycle: inactive directions release later.
    const d = info.angle.degree;
    const active = [d >= 30 && d < 150, d >= 210 && d < 330, d >= 120 && d < 240, d >= 300 || d < 60];
    values.forEach((control, i) => {
      if (active[i]) {send(0, control, 1);}
      else {window.setTimeout(() => send(0, control, 0), 30);}
    });
  });
  const legacyEnd = vi.fn(() => values.forEach(control => send(0, control, 0)));
  stick.on("end", legacyEnd); stick.on("move", legacyMove);
  Object.assign(window, {EJS_emulator: instance});
  const held = () => [...state].filter(([, value]) => value !== 0).map(([control]) => control).sort((a, b) => a - b);
  return {stick, send, held, legacyMove, legacyEnd, adapter, instance, nipplejs, create};
}

it.each([0, 8, 16])("keeps the newest direction held across %ims reversals with no release timers", spacing => {
  const {stick, held, send} = setup();
  stick.emit("move", 0); vi.advanceTimersByTime(spacing);
  stick.emit("move", 180); expect(held()).toEqual([6]); vi.advanceTimersByTime(spacing);
  stick.emit("move", 0); expect(held()).toEqual([7]);
  vi.advanceTimersByTime(200); expect(held()).toEqual([7]); expect(vi.getTimerCount()).toBe(0);
  expect(send.mock.calls.map(([, control, value]) => [control, value])).toEqual([[7, 1], [7, 0], [6, 1], [6, 0], [7, 1]]);
});

it("binds controls constructed before EJS_ready and before the instance is published", () => {
  const {stick, held, legacyMove} = setup(undefined, true);
  stick.emit("move", 180); stick.emit("move", 0); vi.advanceTimersByTime(100);
  expect(held()).toEqual([7]); expect(legacyMove).not.toHaveBeenCalled();
});

it("releases old directions before pressing a new diagonal and deduplicates motion", () => {
  const {stick, held, send} = setup();
  stick.emit("move", 45); expect(held()).toEqual([4, 7]);
  send.mockClear(); for (let i = 0; i < 100; i += 1) {stick.emit("move", 46);}
  expect(send).not.toHaveBeenCalled();
  stick.emit("move", 225); expect(held()).toEqual([5, 6]);
  expect(send.mock.calls.map(([, c, v]) => [c, v])).toEqual([[4, 0], [7, 0], [5, 1], [6, 1]]);
});

it("releases a centered stick and an ended/cancelled contact immediately", () => {
  const {stick, held} = setup();
  stick.emit("move", 0); stick.emit("move", 0, 0); expect(held()).toEqual([]);
  stick.emit("move", 90); stick.emit("end"); expect(held()).toEqual([]);
  vi.advanceTimersByTime(100); expect(held()).toEqual([]);
});

it("does not run stale release callbacks after an end followed by a new contact", () => {
  const {stick, held} = setup();
  stick.emit("move", 180); stick.emit("end"); stick.emit("move", 0);
  vi.advanceTimersByTime(100); expect(held()).toEqual([7]);
});

it("uses configured digital-zone mappings without any core or ROM branch", () => {
  const {stick, held, legacyMove} = setup({id: "custom", joystickInput: false, inputValues: [19, 18, 17, 16]});
  stick.emit("move", 45); expect(held()).toEqual([16, 19]); expect(legacyMove).not.toHaveBeenCalled();
});

it("keeps analog-zone handlers and their values owned by EmulatorJS", () => {
  const {stick, legacyMove, legacyEnd} = setup({id: "dpad", joystickInput: true, inputValues: [16, 17, 18, 19]});
  stick.emit("move", 27); stick.emit("end");
  expect(legacyMove).toHaveBeenCalledOnce(); expect(legacyEnd).toHaveBeenCalledOnce();
});

it("releases on blur and pause, ignores paused motion and accepts input on resume", () => {
  const {stick, held, adapter, instance} = setup();
  stick.emit("move", 0); window.dispatchEvent(new Event("blur")); expect(held()).toEqual([]);
  stick.emit("move", 45); adapter.release(); instance.paused = true;
  stick.emit("move", 180); expect(held()).toEqual([]);
  instance.paused = false; stick.emit("move", 180); expect(held()).toEqual([6]);
});

it("leaves unrelated input and joystick listeners intact and cleans up its own handlers", () => {
  const {stick, send, held, adapter, nipplejs, create} = setup();
  const extra = vi.fn(); stick.on("move", extra);
  send(1, 8, 1); stick.emit("move", 0); expect(held()).toEqual([7, 8]);
  expect(extra).toHaveBeenCalledOnce(); adapter.dispose(); expect(held()).toEqual([8]);
  expect(nipplejs.create).toBe(create); send.mockClear(); stick.emit("move", 90); expect(send).not.toHaveBeenCalled();
  expect(extra).toHaveBeenCalledTimes(2); adapter.dispose();
});
