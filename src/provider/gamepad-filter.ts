import type {RuntimeInputFilterPolicyV1} from "./module-api.js";

type ReservedButton = "select" | "start";
type Candidate = {first: ReservedButton; secondChord: boolean; startedAtMs: number};
type GamepadSnapshot = Pick<Gamepad, "axes" | "buttons" | "connected" | "id" | "index" | "mapping" | "timestamp">;

const chordWindowMs = 100;
const chordReleaseMs = 60;
const secondChordMs = 650;

class ChordDetector {
  private previous = {select: false, start: false};
  private downAt: Record<ReservedButton, number | null> = {select: null, start: null};
  private candidate: Candidate | null = null;
  private chord: {secondChord: boolean} | null = null;
  private firstChordCompletedAtMs: number | null = null;
  private lastNowMs = 0;

  reset() {
    this.previous = {select: false, start: false};
    this.downAt = {select: null, start: null};
    this.candidate = null;
    this.chord = null;
    this.firstChordCompletedAtMs = null;
    this.lastNowMs = 0;
  }

  update(select: boolean, start: boolean, nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.lastNowMs) {this.reset();}
    this.lastNowMs = nowMs;
    const current = {select, start};
    const rising = {select: select && !this.previous.select, start: start && !this.previous.start};
    const falling = {select: !select && this.previous.select, start: !start && this.previous.start};
    for (const key of ["select", "start"] as const) {if (rising[key]) {this.downAt[key] = nowMs;}}
    const output = this.reduce(current, rising, falling, nowMs);
    for (const key of ["select", "start"] as const) {if (falling[key]) {this.downAt[key] = null;}}
    this.previous = current;
    return output;
  }

  private reduce(
    current: Record<ReservedButton, boolean>,
    rising: Record<ReservedButton, boolean>,
    falling: Record<ReservedButton, boolean>,
    nowMs: number,
  ) {
    if (this.chord) {return this.finishChord(current, nowMs);}
    if (this.firstChordCompletedAtMs !== null && nowMs - this.firstChordCompletedAtMs > secondChordMs) {
      this.firstChordCompletedAtMs = null;
    }
    const recognition = this.recognizeChord(current, rising, nowMs);
    if (recognition) {return recognition;}
    const candidate = this.candidate;
    if (candidate && (!current[candidate.first] || nowMs - candidate.startedAtMs >= chordWindowMs)) {
      this.candidate = null;
    }
    return {
      openMenu: false,
      select: this.singleButton("select", current.select, falling.select, nowMs),
      start: this.singleButton("start", current.start, falling.start, nowMs),
    };
  }

  private recognizeChord(
    current: Record<ReservedButton, boolean>,
    rising: Record<ReservedButton, boolean>,
    nowMs: number,
  ) {
    if (!this.candidate) {
      const first = rising.select ? "select" : rising.start ? "start" : null;
      if (first) {
        const elapsed = this.firstChordCompletedAtMs === null ? null : nowMs - this.firstChordCompletedAtMs;
        this.candidate = {
          first,
          secondChord: elapsed !== null && elapsed >= chordReleaseMs && elapsed <= secondChordMs,
          startedAtMs: nowMs,
        };
      }
    }
    const candidate = this.candidate;
    if (!candidate) {return null;}
    const other: ReservedButton = candidate.first === "select" ? "start" : "select";
    if (!rising[other] || !current[candidate.first] || nowMs - candidate.startedAtMs > chordWindowMs) {return null;}
    this.chord = {secondChord: candidate.secondChord};
    this.candidate = null;
    this.downAt = {select: null, start: null};
    if (this.chord.secondChord) {this.firstChordCompletedAtMs = null;}
    return {openMenu: this.chord.secondChord, select: false, start: false};
  }

  private finishChord(current: Record<ReservedButton, boolean>, nowMs: number) {
    if (current.select || current.start) {return {openMenu: false, select: false, start: false};}
    if (!this.chord?.secondChord) {this.firstChordCompletedAtMs = nowMs;}
    this.chord = null;
    return {openMenu: false, select: false, start: false};
  }

  private singleButton(key: ReservedButton, current: boolean, falling: boolean, nowMs: number) {
    if (this.candidate || this.chord) {return false;}
    const downAt = this.downAt[key];
    if (current && downAt !== null) {return nowMs - downAt >= chordWindowMs;}
    const heldFor = downAt === null ? null : nowMs - downAt;
    return falling && heldFor !== null && heldFor < chordWindowMs;
  }
}

export class RuntimeGamepadFilter {
  private readonly detector = new ChordDetector();
  private policy: RuntimeInputFilterPolicyV1;

  constructor(policy: RuntimeInputFilterPolicyV1) {this.policy = {...policy};}

  setPolicy(policy: RuntimeInputFilterPolicyV1) {
    if (policy.activeGamepadIndex !== this.policy.activeGamepadIndex ||
      policy.suppressInput !== this.policy.suppressInput) {this.detector.reset();}
    this.policy = {...policy};
  }

  filter(gamepads: readonly (GamepadSnapshot | null)[], nowMs: number): (Gamepad | null)[] {
    if (this.policy.suppressInput) {return gamepads.map((gamepad) => gamepad ? zeroGamepad(gamepad) : null);}
    const active = this.policy.activeGamepadIndex === null ? null :
      gamepads.find((gamepad) => gamepad?.index === this.policy.activeGamepadIndex) ?? null;
    if (!active) {this.detector.reset(); return [...gamepads] as (Gamepad | null)[];}
    const output = this.detector.update(pressed(active.buttons[8]), pressed(active.buttons[9]), nowMs);
    if (output.openMenu) {return gamepads.map((gamepad) => gamepad ? zeroGamepad(gamepad) : null);}
    return gamepads.map((gamepad) => {
      if (!gamepad || gamepad.index !== this.policy.activeGamepadIndex) {return gamepad as Gamepad | null;}
      const buttons = [...gamepad.buttons];
      buttons[8] = filteredButton(buttons[8], output.select);
      buttons[9] = filteredButton(buttons[9], output.start);
      return cloneGamepad(gamepad, buttons, gamepad.axes);
    });
  }
}

export function installRuntimeGamepadFilter(runtimeWindow: Window, filter: RuntimeGamepadFilter) {
  const gamepadNavigator = runtimeWindow.navigator;
  const ownDescriptor = Object.getOwnPropertyDescriptor(gamepadNavigator, "getGamepads");
  if (ownDescriptor && !ownDescriptor.configurable) {throw new Error("PLAYER_INPUT_FILTER_UNAVAILABLE");}
  const nativeGetGamepads = gamepadNavigator.getGamepads;
  if (typeof nativeGetGamepads !== "function") {throw new Error("PLAYER_INPUT_FILTER_UNAVAILABLE");}
  const filteredGetGamepads = () => filter.filter(
    Array.from(nativeGetGamepads.call(gamepadNavigator)), runtimeWindow.performance.now(),
  );
  Object.defineProperty(gamepadNavigator, "getGamepads", {
    configurable: true, enumerable: ownDescriptor?.enumerable ?? false,
    value: filteredGetGamepads, writable: true,
  });
  return () => {
    if (gamepadNavigator.getGamepads !== filteredGetGamepads) {return;}
    if (ownDescriptor) {Object.defineProperty(gamepadNavigator, "getGamepads", ownDescriptor);}
    else {Reflect.deleteProperty(gamepadNavigator, "getGamepads");}
  };
}

function pressed(button: GamepadButton | undefined) {return Boolean(button && (button.pressed || button.value >= 0.5));}
function filteredButton(source: GamepadButton | undefined, isPressed: boolean): GamepadButton {
  return {pressed: isPressed, touched: source?.touched ?? isPressed, value: isPressed ? Math.max(0.5, source?.value ?? 1) : 0};
}
function cloneGamepad(gamepad: GamepadSnapshot, buttons: readonly GamepadButton[], axes: readonly number[]) {
  return {
    axes: [...axes],
    buttons: buttons.map(({pressed, touched, value}) => ({pressed, touched, value})),
    connected: gamepad.connected,
    id: gamepad.id, index: gamepad.index, mapping: gamepad.mapping, timestamp: gamepad.timestamp,
  } as unknown as Gamepad;
}
function zeroGamepad(gamepad: GamepadSnapshot) {
  return cloneGamepad(gamepad, gamepad.buttons.map(() => ({pressed: false, touched: false, value: 0})),
    gamepad.axes.map(() => 0));
}
