import {inputObserver} from "./input-observations.js";

/** Standard-mapping indices: bottom/right/left/top face buttons and the D-pad. */
const faceButtons = [{index: 0, label: "A", slot: "bottom"}, {index: 1, label: "B", slot: "right"},
  {index: 2, label: "X", slot: "left"}, {index: 3, label: "Y", slot: "top"}] as const;
const dpad = {up: 12, down: 13, left: 14, right: 15} as const;
const buttonCount = 17;
const device = "touch-gamepad";

type GamepadLike = Pick<Gamepad, "axes" | "buttons" | "connected" | "id" | "index" | "mapping" | "timestamp">;

/** Pressed standard buttons of the on-screen pad; pure so merging is testable without a DOM. */
export class TouchGamepadState {
  private readonly pressed = new Set<number>();
  private changedAt = 0;

  set(index: number, down: boolean, nowMs: number) {
    if (this.pressed.has(index) === down) {return false;}
    if (down) {this.pressed.add(index);} else {this.pressed.delete(index);}
    this.changedAt = nowMs;
    return true;
  }

  releaseAll(nowMs: number) {
    const released = [...this.pressed];
    for (const index of released) {this.set(index, false, nowMs);}
    return released;
  }

  isPressed(index: number) {return this.pressed.has(index);}

  snapshot(): GamepadLike {
    return {
      axes: [0, 0, 0, 0],
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
  if (!physical) {result[0] = touch; return result;}
  result[0] = {
    axes: [...physical.axes], connected: physical.connected, id: physical.id, index: physical.index,
    mapping: physical.mapping, timestamp: Math.max(physical.timestamp, touch.timestamp),
    buttons: physical.buttons.map((button, index) => {
      const down = Boolean(touch.buttons[index]?.pressed);
      return down ? {pressed: true, touched: true, value: 1} : {pressed: button.pressed, touched: button.touched, value: button.value};
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

export type TouchGamepad = {
  /** Current pad for the gamepad filter, or null while hidden. */
  current(): GamepadLike | null;
  /** A physical controller in use hides the touch layout until the next touch. */
  observePhysical(gamepads: readonly (GamepadLike | null)[]): void;
  cleanup(): void;
};

const styleText = `
[data-retrom-touch-gamepad]{position:fixed;inset:0;pointer-events:none;z-index:2147483646;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:system-ui,sans-serif}
[data-retrom-touch-gamepad][hidden]{display:none}
[data-retrom-touch-gamepad] [data-control]{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;
  border:2px solid rgba(255,255,255,.55);background:rgba(20,22,30,.35);color:rgba(255,255,255,.85);
  display:flex;align-items:center;justify-content:center;opacity:.7}
[data-retrom-touch-gamepad] [data-control="dpad"]{--size:clamp(120px,34vmin,180px);width:var(--size);height:var(--size);
  left:max(20px,env(safe-area-inset-left));bottom:max(20px,env(safe-area-inset-bottom));border-radius:50%}
[data-retrom-touch-gamepad] [data-arrow]{position:absolute;width:0;height:0;border:10px solid transparent;pointer-events:none}
[data-retrom-touch-gamepad] [data-arrow="up"]{top:10%;border-bottom-color:currentColor}
[data-retrom-touch-gamepad] [data-arrow="down"]{bottom:10%;border-top-color:currentColor}
[data-retrom-touch-gamepad] [data-arrow="left"]{left:10%;border-right-color:currentColor}
[data-retrom-touch-gamepad] [data-arrow="right"]{right:10%;border-left-color:currentColor}
[data-retrom-touch-gamepad] [data-arrow][data-active]{color:#fff}
[data-retrom-touch-gamepad] [data-face]{--size:clamp(48px,13vmin,68px);--gap:calc(var(--size) * .95);width:var(--size);height:var(--size);
  border-radius:50%;font-size:calc(var(--size) * .38);font-weight:600;
  right:calc(max(20px,env(safe-area-inset-right)) + var(--gap));bottom:calc(max(20px,env(safe-area-inset-bottom)) + var(--gap))}
[data-retrom-touch-gamepad] [data-face="bottom"]{transform:translateY(var(--gap))}
[data-retrom-touch-gamepad] [data-face="right"]{transform:translateX(var(--gap))}
[data-retrom-touch-gamepad] [data-face="left"]{transform:translateX(calc(var(--gap) * -1))}
[data-retrom-touch-gamepad] [data-face="top"]{transform:translateY(calc(var(--gap) * -1))}
[data-retrom-touch-gamepad] [data-face][data-active]{background:rgba(255,255,255,.4);color:#fff;opacity:.95}
`;

/** Shows an on-screen standard gamepad on touch-first devices inside a same-origin runtime frame. */
export function installTouchGamepad(frameWindow: Window): TouchGamepad {
  const document = frameWindow.document;
  const state = new TouchGamepadState();
  const now = () => frameWindow.performance.now();
  const style = document.createElement("style");
  style.dataset.retromTouchGamepadStyle = "";
  style.textContent = styleText;
  document.head.append(style);
  const root = document.createElement("div");
  root.dataset.retromTouchGamepad = "";
  root.setAttribute("aria-hidden", "true");

  const pad = document.createElement("div");
  pad.dataset.control = "dpad";
  const arrows = new Map<number, HTMLElement>();
  for (const [name, index] of Object.entries(dpad)) {
    const arrow = document.createElement("span");
    arrow.dataset.arrow = name;
    pad.append(arrow); arrows.set(index, arrow);
  }
  root.append(pad);
  const faces = new Map<number, HTMLElement>();
  for (const {index, label, slot} of faceButtons) {
    const button = document.createElement("div");
    button.dataset.control = "face"; button.dataset.face = slot; button.textContent = label;
    root.append(button); faces.set(index, button);
  }
  document.body.append(root);

  // Each touch owns one control; the D-pad follows its finger until release.
  const owners = new Map<number, {control: "dpad" | number; held: readonly number[]}>();
  const heldElsewhere = (pointerId: number, index: number) =>
    [...owners].some(([id, owner]) => id !== pointerId && owner.held.includes(index));
  const apply = (index: number, down: boolean) => {
    if (!state.set(index, down, now())) {return;}
    (arrows.get(index) ?? faces.get(index))?.toggleAttribute("data-active", down);
    inputObserver(frameWindow)?.record({device, control: `Button ${index}`, value: down ? 1 : 0,
      stage: "BROWSER", target: null, reason: null}, now());
  };
  const hold = (pointerId: number, control: "dpad" | number, next: readonly number[]) => {
    const previous = owners.get(pointerId)?.held ?? [];
    owners.set(pointerId, {control, held: next});
    for (const index of previous) {if (!next.includes(index) && !heldElsewhere(pointerId, index)) {apply(index, false);}}
    for (const index of next) {apply(index, true);}
  };
  const release = (pointerId: number) => {
    const owner = owners.get(pointerId);
    if (!owner) {return;}
    owners.delete(pointerId);
    for (const index of owner.held) {if (!heldElsewhere(pointerId, index)) {apply(index, false);}}
  };
  const releaseAll = () => {
    owners.clear();
    for (const index of state.releaseAll(now())) {
      (arrows.get(index) ?? faces.get(index))?.removeAttribute("data-active");
      inputObserver(frameWindow)?.record({device, control: `Button ${index}`, value: 0, stage: "BROWSER", target: null, reason: null}, now());
    }
  };
  const padDirections = (event: PointerEvent) => {
    const bounds = pad.getBoundingClientRect();
    return dpadDirections(event.clientX - (bounds.left + bounds.width / 2), event.clientY - (bounds.top + bounds.height / 2), bounds.width / 2);
  };
  const swallow = (event: Event) => {event.preventDefault(); event.stopPropagation();};

  const down = (event: PointerEvent) => {
    const control = (event.target as Element | null)?.closest?.("[data-control]");
    if (!control || !root.contains(control)) {return;}
    swallow(event);
    (control as HTMLElement).setPointerCapture?.(event.pointerId);
    if (control === pad) {hold(event.pointerId, "dpad", padDirections(event)); return;}
    const index = [...faces].find(([, element]) => element === control)?.[0];
    if (index !== undefined) {hold(event.pointerId, index, [index]);}
  };
  const move = (event: PointerEvent) => {
    const owner = owners.get(event.pointerId);
    if (!owner) {return;}
    swallow(event);
    if (owner.control === "dpad") {hold(event.pointerId, "dpad", padDirections(event));}
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
  root.hidden = true;
  setVisible(Boolean(touchFirst?.matches));
  const touched = (event: PointerEvent) => {if (event.pointerType === "touch") {setVisible(true);}};
  frameWindow.addEventListener("pointerdown", touched, true);
  const hiddenPage = () => {if (document.visibilityState !== "visible") {releaseAll();}};
  frameWindow.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", hiddenPage);

  return {
    current: () => root.hidden ? null : state.snapshot(),
    observePhysical: (gamepads) => {
      physicalAtZero = Boolean(gamepads[0]);
      if (root.hidden) {return;}
      const active = gamepads.some((gamepad) => gamepad?.buttons.some((button) => button.pressed));
      if (active) {setVisible(false);}
    },
    cleanup: () => {
      releaseAll();
      frameWindow.removeEventListener("pointerdown", touched, true);
      frameWindow.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", hiddenPage);
      root.remove(); style.remove();
    },
  };
}
