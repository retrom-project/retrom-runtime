import {inputObserver} from "./input-observations.js";
import type {RuntimeTouchGamepadV1} from "./module-api.js";
import {touchGamepadLayout, touchGamepadStyle, type TouchGamepadOptions} from "./touch-gamepad-layout.js";

/** Standard-mapping indices: bottom/right/left/top face buttons and the D-pad. */
const dpad = {up: 12, down: 13, left: 14, right: 15} as const;
const buttonCount = 17;
const device = "touch-gamepad";

type GamepadLike = Pick<Gamepad, "axes" | "buttons" | "connected" | "id" | "index" | "mapping" | "timestamp">;

/** Pressed standard buttons of the on-screen pad; pure so merging is testable without a DOM. */
export class TouchGamepadState {
  private readonly pressed = new Set<number>();
  private changedAt = 0;
  private axes = [0, 0, 0, 0];

  setAxis(index: number, value: number, nowMs: number) {
    const next = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    if (this.axes[index] === next) {return false;}
    this.axes[index] = next; this.changedAt = nowMs;
    return true;
  }

  set(index: number, down: boolean, nowMs: number) {
    if (this.pressed.has(index) === down) {return false;}
    if (down) {this.pressed.add(index);} else {this.pressed.delete(index);}
    this.changedAt = nowMs;
    return true;
  }

  releaseAll(nowMs: number) {
    const released = [...this.pressed];
    for (const index of released) {this.set(index, false, nowMs);}
    for (let index = 0; index < this.axes.length; index++) {this.setAxis(index, 0, nowMs);}
    return released;
  }

  isPressed(index: number) {return this.pressed.has(index);}

  snapshot(): GamepadLike {
    return {
      axes: [...this.axes],
      buttons: Array.from({length: buttonCount}, (_, index) => {
        const down = this.pressed.has(index);
        return {pressed: down, touched: down, value: down ? 1 : 0};
      }),
      connected: true, id: "Retrom touch gamepad (STANDARD GAMEPAD)", index: 0, mapping: "standard",
      timestamp: this.changedAt,
    } as unknown as GamepadLike;
  }
}

/** The on-screen pad acts as player 1: it is merged into slot 0, OR-ing with a physical pad there. */
export function mergeTouchGamepad(gamepads: readonly (GamepadLike | null)[], touch: GamepadLike | null) {
  if (!touch) {return [...gamepads];}
  const result = [...gamepads];
  const physical = result[0];
  if (!physical || physical.mapping !== "standard") {result[0] = touch; return result;}
  result[0] = {
    axes: Array.from({length: Math.max(physical.axes.length, touch.axes.length)}, (_, index) =>
      touch.axes[index] || physical.axes[index] || 0), connected: physical.connected, id: physical.id, index: physical.index,
    mapping: physical.mapping, timestamp: Math.max(physical.timestamp, touch.timestamp),
    buttons: Array.from({length: Math.max(physical.buttons.length, touch.buttons.length)}, (_, index) => {
      const button = physical.buttons[index];
      const down = Boolean(touch.buttons[index]?.pressed);
      return down ? {pressed: true, touched: true, value: 1} : {pressed: button?.pressed ?? false, touched: button?.touched ?? false, value: button?.value ?? 0};
    }),
  } as unknown as GamepadLike;
  return result;
}

/** D-pad direction for a point relative to the pad centre, with a dead zone and 45-degree diagonals. */
export function dpadDirections(dx: number, dy: number, radius: number) {
  const distance = Math.hypot(dx, dy);
  if (!(radius > 0) || distance < radius * 0.25) {return [];}
  const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return ([
    [dpad.right], [dpad.right, dpad.down], [dpad.down], [dpad.down, dpad.left],
    [dpad.left], [dpad.left, dpad.up], [dpad.up], [dpad.up, dpad.right],
  ] as const)[sector];
}

export type TouchGamepad = RuntimeTouchGamepadV1 & {
  /** Current pad for the gamepad filter, or null while hidden. */
  current(): GamepadLike | null;
  /** A physical controller in use hides the touch layout until the next touch. */
  observePhysical(gamepads: readonly (GamepadLike | null)[]): void;
  releaseAll(): void;
  setSuspended(suspended: boolean): void;
  cleanup(): void;
};

/** Shows an on-screen standard gamepad on touch-first devices inside a same-origin runtime frame. */
export function installTouchGamepad(frameWindow: Window, options: TouchGamepadOptions = {}): TouchGamepad {
  const document = frameWindow.document;
  const state = new TouchGamepadState();
  const now = () => frameWindow.performance.now();
  const style = document.createElement("style");
  style.dataset.retromTouchGamepadStyle = "";
  style.textContent = touchGamepadStyle;
  document.head.append(style);
  const root = document.createElement("div");
  root.dataset.retromTouchGamepad = "";
  root.dataset.layout = options.layout ?? "STANDARD";
  root.setAttribute("aria-hidden", "true");
  const layout = touchGamepadLayout(options.layout, options);

  const pad = document.createElement("div");
  pad.dataset.control = "dpad";
  const padKnob = document.createElement("span");
  padKnob.dataset.knob = ""; pad.append(padKnob);
  root.append(pad);
  const faces = new Map<number, HTMLElement>();
  for (const {index, label, slot} of layout.faces) {
    const button = document.createElement("div");
    button.dataset.control = "face"; button.dataset.face = slot; button.textContent = label;
    root.append(button); faces.set(index, button);
  }
  for (const {index, label, side} of layout.auxiliary) {
    const button = document.createElement("div");
    button.dataset.control = "button"; button.dataset.button = String(index);
    button.dataset.side = side; button.textContent = label;
    root.append(button); faces.set(index, button);
  }
  const analog = layout.analog ? document.createElement("div") : null;
  const knob = analog ? document.createElement("span") : null;
  if (analog && knob) {
    analog.dataset.control = "analog"; knob.dataset.knob = "";
    analog.append(knob); root.append(analog);
  }
  document.body.append(root);

  // Each touch owns one control; the D-pad follows its finger until release.
  const owners = new Map<number, {control: "dpad" | "analog" | number; held: readonly number[]; point?: {x: number; y: number}}>();
  const heldElsewhere = (pointerId: number, index: number) =>
    [...owners].some(([id, owner]) => id !== pointerId && owner.held.includes(index));
  const apply = (index: number, down: boolean) => {
    if (!state.set(index, down, now())) {return;}
    faces.get(index)?.toggleAttribute("data-active", down);
    inputObserver(frameWindow)?.record({device, control: `Button ${index}`, value: down ? 1 : 0,
      stage: "BROWSER", target: null, reason: null}, now());
  };
  const hold = (pointerId: number, control: "dpad" | "analog" | number, next: readonly number[]) => {
    const previous = owners.get(pointerId)?.held ?? [];
    owners.set(pointerId, {control, held: next});
    for (const index of previous) {if (!next.includes(index) && !heldElsewhere(pointerId, index)) {apply(index, false);}}
    for (const index of next) {apply(index, true);}
  };
  const release = (pointerId: number) => {
    const owner = owners.get(pointerId);
    if (!owner) {return;}
    owners.delete(pointerId);
    if (owner.control === "analog") {resetAnalog();}
    if (owner.control === "dpad") {
      const remaining = [...owners.values()].reverse().find(value => value.control === "dpad")?.point;
      positionStick(pad, remaining?.x ?? 0, remaining?.y ?? 0);
    }
    for (const index of owner.held) {if (!heldElsewhere(pointerId, index)) {apply(index, false);}}
  };
  const releaseAll = () => {
    owners.clear();
    resetAnalog(); positionStick(pad);
    for (const index of state.releaseAll(now())) {
      faces.get(index)?.removeAttribute("data-active");
      inputObserver(frameWindow)?.record({device, control: `Button ${index}`, value: 0, stage: "BROWSER", target: null, reason: null}, now());
    }
  };
  const resetAnalog = () => {
    state.setAxis(0, 0, now()); state.setAxis(1, 0, now());
    if (analog) {positionStick(analog);}
  };
  const positionStick = (control: HTMLElement, x = 0, y = 0) => {
    control.toggleAttribute("data-active", x !== 0 || y !== 0);
    for (const [axis, value] of [["x", x], ["y", y]] as const) {
      if (value === 0) {control.style.removeProperty(`--stick-${axis}`);}
      else {control.style.setProperty(`--stick-${axis}`, `${value}px`);}
    }
  };
  const moveStick = (event: PointerEvent, control: HTMLElement, x: number, y: number) => {
    const distance = Math.hypot(x, y), scale = distance > 1 ? 1 / distance : 1;
    const travel = control.getBoundingClientRect().width / 4;
    const point = {x: x * scale * travel, y: y * scale * travel};
    const owner = owners.get(event.pointerId);
    if (owner) {owner.point = point;}
    positionStick(control, point.x, point.y);
  };
  const moveAnalog = (event: PointerEvent) => {
    if (!analog || !knob) {return;}
    const bounds = analog.getBoundingClientRect(), radius = bounds.width / 2;
    if (!(radius > 0)) {return;}
    const dx = (event.clientX - bounds.left - radius) / radius;
    const dy = (event.clientY - bounds.top - radius) / radius;
    const distance = Math.hypot(dx, dy), scale = distance > 1 ? 1 / distance : 1;
    const x = distance < .15 ? 0 : dx * scale, y = distance < .15 ? 0 : dy * scale;
    state.setAxis(0, x, now()); state.setAxis(1, y, now());
    moveStick(event, analog, x, y);
  };
  const moveDpad = (event: PointerEvent) => {
    const bounds = pad.getBoundingClientRect(), radius = bounds.width / 2;
    const dx = event.clientX - (bounds.left + radius), dy = event.clientY - (bounds.top + bounds.height / 2);
    hold(event.pointerId, "dpad", dpadDirections(dx, dy, radius));
    if (radius > 0) {moveStick(event, pad, dx / radius, dy / radius);}
  };
  const swallow = (event: Event) => {event.preventDefault(); event.stopPropagation();};

  const down = (event: PointerEvent) => {
    const control = (event.target as Element | null)?.closest?.("[data-control]");
    if (!control || !root.contains(control)) {return;}
    if (root.hidden) {return;}
    swallow(event);
    (control as HTMLElement).setPointerCapture?.(event.pointerId);
    if (control === pad) {moveDpad(event); return;}
    if (control === analog) {
      if ([...owners.values()].some(owner => owner.control === "analog")) {return;}
      hold(event.pointerId, "analog", []); moveAnalog(event); return;
    }
    const index = [...faces].find(([, element]) => element === control)?.[0];
    if (index !== undefined) {hold(event.pointerId, index, [index]);}
  };
  const move = (event: PointerEvent) => {
    const owner = owners.get(event.pointerId);
    if (!owner) {return;}
    swallow(event);
    if (owner.control === "dpad") {moveDpad(event);}
    if (owner.control === "analog") {moveAnalog(event);}
  };
  const up = (event: PointerEvent) => {
    if (!owners.has(event.pointerId)) {return;}
    swallow(event); release(event.pointerId);
  };
  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {root.addEventListener(type, up);}
  root.addEventListener("contextmenu", swallow);

  let announced = false;
  let physicalAtZero = false;
  const announce = (type: "gamepadconnected" | "gamepaddisconnected") => {
    const event = new (frameWindow as Window & {Event: typeof Event}).Event(type);
    Object.defineProperty(event, "gamepad", {value: state.snapshot()});
    frameWindow.dispatchEvent(event);
  };
  const setVisible = (visible: boolean) => {
    if (root.hidden === !visible) {return;}
    root.hidden = !visible;
    if (!visible) {releaseAll();}
    // A physical pad in slot 0 already announced itself; otherwise the core must learn about this one.
    if (visible && !announced && !physicalAtZero) {announced = true; announce("gamepadconnected");}
    if (!visible && announced && !physicalAtZero) {announced = false; announce("gamepaddisconnected");}
  };
  const touchFirst = frameWindow.matchMedia?.("(hover: none) and (pointer: coarse)");
  let enabled = options.enabled ?? true, suspended = false, disposed = false;
  let touchActive = Boolean(touchFirst?.matches), physicalHidden = false;
  const refresh = () => setVisible(enabled && !suspended && touchActive && !physicalHidden);
  root.hidden = true;
  refresh();
  const touched = (event: PointerEvent) => {
    if (event.pointerType === "touch") {touchActive = true; physicalHidden = false; refresh();}
  };
  frameWindow.addEventListener("pointerdown", touched, true);
  const hiddenPage = () => {if (document.visibilityState !== "visible") {releaseAll();}};
  frameWindow.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", hiddenPage);

  return {
    getState: () => ({enabled}),
    releaseAll,
    setEnabled: async (value) => {
      if (disposed || typeof value !== "boolean") {throw new Error("PLAYER_RUNTIME_CONTRACT_INVALID");}
      enabled = value;
      if (value) {touchActive = true; physicalHidden = false;}
      refresh();
    },
    setSuspended: (value) => {if (!disposed) {suspended = value; refresh();}},
    current: () => root.hidden || disposed ? null : state.snapshot(),
    observePhysical: (gamepads) => {
      if (disposed) {return;}
      physicalAtZero = Boolean(gamepads[0]);
      if (root.hidden) {return;}
      const active = gamepads.some((gamepad) => gamepad?.buttons.some((button) => button.pressed));
      if (active) {physicalHidden = true; refresh();}
    },
    cleanup: () => {
      if (disposed) {return;}
      disposed = true;
      releaseAll();
      frameWindow.removeEventListener("pointerdown", touched, true);
      frameWindow.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", hiddenPage);
      root.remove(); style.remove();
    },
  };
}
