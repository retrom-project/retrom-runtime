import type {RuntimeInputDiagnosticsV1} from "./module-api.js";
import {InputObservations, registerInputObserver} from "./input-observations.js";

/** Runs only while explicitly enabled. Never schedules input polling or calls the filter. */
export function startInputDiagnostics(runtimeWindow: Window, canvas: () => HTMLCanvasElement | null): RuntimeInputDiagnosticsV1 {
  const observations = new InputObservations();
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let keyboard = false;
  let gamepad = false;
  let document: Document | null = null;
  const now = () => runtimeWindow.performance.now();
  try {
    document = runtimeWindow.document;
    cleanups.push(registerInputObserver(runtimeWindow, observations));
    const recordKey = (event: KeyboardEvent, stage: "BROWSER" | "DELIVERED") => {
      if (event.repeat || !event.code) {return;}
      observations.record({device: "keyboard", control: event.code.slice(0, 40), value: event.type === "keydown" ? 1 : 0,
        stage, target: stage === "DELIVERED" ? "canvas" : null, reason: null}, now());
    };
    const key = (event: KeyboardEvent) => recordKey(event, "BROWSER");
    const delivered = (event: KeyboardEvent) => recordKey(event, "DELIVERED");
    const surface = canvas();
    surface?.addEventListener("keydown", delivered, {passive: true});
    surface?.addEventListener("keyup", delivered, {passive: true});
    cleanups.push(() => {
      surface?.removeEventListener("keydown", delivered); surface?.removeEventListener("keyup", delivered);
    });
    const blur = () => observations.resetHeld();
    const visibility = () => {if (document?.hidden) {blur();}};
    runtimeWindow.addEventListener("keydown", key, {capture: true, passive: true});
    runtimeWindow.addEventListener("keyup", key, {capture: true, passive: true});
    runtimeWindow.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    cleanups.push(() => {
      runtimeWindow.removeEventListener("keydown", key, true); runtimeWindow.removeEventListener("keyup", key, true);
      runtimeWindow.removeEventListener("blur", blur); document?.removeEventListener("visibilitychange", visibility);
    });
    keyboard = true;
    const cleanupGamepad = observeGamepadReads(runtimeWindow, observations);
    if (cleanupGamepad) {cleanups.push(cleanupGamepad); gamepad = true;}
  } catch {
    // Isolated origins and non-configurable browser APIs are explicitly unobservable.
    // Diagnostics are never allowed to fail a running game.
  }
  return {
    read: () => ({...observations.read(), focus: focus(document, canvas), keyboard, gamepad, delivery: keyboard, coreRead: false}),
    clear: () => observations.clear(),
    stop: () => {
      if (stopped) {return;} stopped = true;
      for (const cleanup of cleanups.reverse()) {
        try {cleanup();} catch { /* A runtime may have replaced or frozen its browser API. */ }
      }
    },
  };
}

function focus(document: Document | null, canvas: () => HTMLCanvasElement | null) {
  if (!document?.hasFocus()) {return "UNFOCUSED" as const;}
  return document.activeElement === canvas() ? "GAME" as const : "OTHER" as const;
}

function observeGamepadReads(runtimeWindow: Window, observations: InputObservations) {
  const navigator = runtimeWindow.navigator;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
  const original = navigator.getGamepads;
  if (descriptor && !descriptor.configurable || typeof original !== "function") {return null;}
  let active = true;
  const previous = new Map<number, number[]>();
  const observed: Navigator["getGamepads"] = function (this: Navigator) {
    const result = original.call(this);
    // The exact browser/filter result is returned. Instrumentation errors must not reach the consumer.
    try {if (active && !runtimeWindow.document.hidden) {recordGamepads(result, previous, observations, runtimeWindow.performance.now());}} catch { /* Observation only. */ }
    return result;
  };
  Object.defineProperty(navigator, "getGamepads", {configurable: true, enumerable: descriptor?.enumerable ?? false, writable: true, value: observed});
  const disconnected = (event: GamepadEvent) => {previous.delete(event.gamepad.index); observations.releaseDevice(`gamepad:${event.gamepad.index}`);};
  runtimeWindow.addEventListener("gamepaddisconnected", disconnected);
  return () => {
    active = false;
    runtimeWindow.removeEventListener("gamepaddisconnected", disconnected);
    if (navigator.getGamepads !== observed) {return;}
    if (descriptor) {Object.defineProperty(navigator, "getGamepads", descriptor);} else {Reflect.deleteProperty(navigator, "getGamepads");}
  };
}

function recordGamepads(gamepads: (Gamepad | null)[], previous: Map<number, number[]>, observations: InputObservations, atMs: number) {
  for (const index of previous.keys()) {
    if (!gamepads.some((pad) => pad?.connected && pad.index === index)) {
      previous.delete(index); observations.releaseDevice(`gamepad:${index}`);
    }
  }
  for (const pad of gamepads.slice(0, 4)) {
    if (!pad?.connected) {continue;}
    const device = `gamepad:${pad.index}`;
    const values = previous.get(pad.index) ?? new Array<number>(40).fill(0);
    previous.set(pad.index, values);
    for (let index = 0; index < Math.min(32, pad.buttons.length); index++) {
      const button = pad.buttons[index];
      const value = button.pressed ? Math.max(0.1, quantize(button.value)) : quantize(button.value);
      if (value === values[index]) {continue;}
      values[index] = value;
      observations.record({device, control: `Button ${index}`, value, stage: "RUNTIME", target: null, reason: null}, atMs);
    }
    for (let index = 0; index < Math.min(8, pad.axes.length); index++) {
      const value = quantize(pad.axes[index]);
      if (value === values[32 + index]) {continue;}
      values[32 + index] = value;
      observations.record({device, control: `Axis ${index}`, value, stage: "RUNTIME", target: null, reason: null}, atMs);
    }
  }
}

function quantize(value: number) {return Number.isFinite(value) ? Math.round(Math.max(-1, Math.min(1, value)) * 10) / 10 : 0;}
