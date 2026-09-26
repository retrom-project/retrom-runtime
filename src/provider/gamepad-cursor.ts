import type {RuntimeGamepadCursorV1, RuntimeInputFilterPolicyV1} from "./module-api.js";
import {createCursorSurface, type CursorPosition} from "./gamepad-cursor-surface.js";
import {captureGamepadSource} from "./gamepad-filter.js";

const ownedButtons = [0, 1, 4, 12, 13, 14, 15];
type CursorOptions = {defaultEnabled: boolean; protocol?: "mouse" | "pointer"};
export type GamepadCursor = RuntimeGamepadCursorV1 & {
  setSuspended(suspended: boolean): void;
  setInputPolicy(policy: RuntimeInputFilterPolicyV1 | null): void;
  dispose(): void;
};

export function installGamepadCursor(frameWindow: Window, target: HTMLElement, options: CursorOptions): GamepadCursor {
  return new GamepadCursorController(frameWindow, target, options);
}

class GamepadCursorController implements GamepadCursor {
  private readonly surface: ReturnType<typeof createCursorSurface>;
  private readonly nativeGetGamepads: Navigator["getGamepads"];
  private readonly readGamepads: () => (Gamepad | null)[];
  private readonly descriptor: PropertyDescriptor | undefined;
  private enabled: boolean;
  private disposed = false;
  private suspended = false;
  private unfocused = false;
  private policy: RuntimeInputFilterPolicyV1 | null = null;
  private activeIndex: number | null = null;
  private neutralReady = false;
  private releaseGate = false;
  private previousTime: number | null = null;
  private frame = 0;
  private position: CursorPosition = {x: 0.5, y: 0.5};
  private held = 0;
  private downAt = new Map<number, CursorPosition>();
  private dragged = new Set<number>();

  constructor(private readonly window: Window, target: HTMLElement, private readonly options: CursorOptions) {
    this.enabled = options.defaultEnabled;
    const navigator = window.navigator;
    this.descriptor = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
    this.nativeGetGamepads = navigator.getGamepads ?? (() => []);
    this.readGamepads = captureGamepadSource(window);
    if (this.descriptor && !this.descriptor.configurable) {
      throw new Error("PLAYER_INPUT_FILTER_UNAVAILABLE");
    }
    this.surface = createCursorSurface(window, target, options.protocol ?? "mouse");
    Object.defineProperty(navigator, "getGamepads", {configurable: true, value: this.filteredGamepads});
    window.addEventListener("blur", this.blur);
    window.addEventListener("focus", this.focus);
    window.document.addEventListener("visibilitychange", this.visibility);
    this.frame = window.requestAnimationFrame(this.poll);
  }

  getState() {return {enabled: this.enabled, defaultEnabled: this.options.defaultEnabled};}

  setEnabled(enabled: boolean) {
    if (this.disposed || typeof enabled !== "boolean") {throw new Error("PLAYER_RUNTIME_CONTRACT_INVALID");}
    if (enabled === this.enabled) {return;}
    this.reset();
    this.releaseGate = true;
    this.enabled = enabled;
  }

  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) {return;}
    this.suspended = suspended;
    this.reset();
  }

  setInputPolicy(policy: RuntimeInputFilterPolicyV1 | null) {
    if (policy?.activeGamepadIndex !== this.policy?.activeGamepadIndex || policy?.suppressInput !== this.policy?.suppressInput) {
      this.reset();
      this.activeIndex = null;
    }
    this.policy = policy ? {...policy} : null;
  }

  dispose() {
    if (this.disposed) {return;}
    this.reset(); this.disposed = true;
    this.window.cancelAnimationFrame(this.frame);
    this.window.removeEventListener("blur", this.blur);
    this.window.removeEventListener("focus", this.focus);
    this.window.document.removeEventListener("visibilitychange", this.visibility);
    if (this.window.navigator.getGamepads === this.filteredGamepads) {
      if (this.descriptor) {Object.defineProperty(this.window.navigator, "getGamepads", this.descriptor);}
      else {Reflect.deleteProperty(this.window.navigator, "getGamepads");}
    }
    this.surface.dispose();
  }

  private readonly blur = () => {this.unfocused = true; this.reset();};
  private readonly focus = () => {if (this.unfocused) {this.unfocused = false; this.reset();}};
  private readonly visibility = () => {if (this.window.document.hidden) {this.blur();} else {this.focus();}};
  private blocked() {return this.suspended || this.unfocused || Boolean(this.policy?.suppressInput);}
  private sample() {
    try {return this.readGamepads();}
    catch {return [];}
  }
  private select(pads: readonly (Gamepad | null)[]) {
    const requested = this.policy?.activeGamepadIndex ?? this.activeIndex;
    const eligible = pads.filter((pad): pad is Gamepad => Boolean(pad?.connected && pad.mapping === "standard"));
    return requested === null ? eligible[0] ?? null : eligible.find(pad => pad.index === requested) ?? null;
  }
  private readonly filteredGamepads = () => {
    const pads = Array.from(this.nativeGetGamepads.call(this.window.navigator));
    const selected = this.select(pads);
    if ((!this.enabled && !this.releaseGate) || !selected) {return pads;}
    return pads.map(pad => pad !== selected ? pad : {
      id: pad.id, index: pad.index, connected: pad.connected, mapping: pad.mapping, timestamp: pad.timestamp, vibrationActuator: pad.vibrationActuator,
      axes: pad.axes.map((value, index) => index < 2 ? 0 : value),
      buttons: pad.buttons.map((button, index) => ownedButtons.includes(index)
        ? {pressed: false, touched: false, value: 0}
        : {pressed: button.pressed, touched: button.touched, value: button.value}),
    });
  };

  private readonly poll = (time: number) => {
    if (this.disposed) {return;}
    this.update(time);
    this.frame = this.window.requestAnimationFrame(this.poll);
  };

  private update(time: number) {
    const elapsed = this.previousTime === null ? 0 : Math.max(0, Math.min(50, time - this.previousTime));
    this.previousTime = time;
    const pad = this.select(this.sample());
    if (!pad) {this.reset(); this.activeIndex = null; return;}
    if (this.activeIndex !== pad.index) {this.reset(); this.activeIndex = pad.index;}
    if (this.blocked()) {this.reset(); return;}
    const vector = direction(pad);
    if (!this.neutralReady) {
      this.neutralReady = ownedButtons.every(index => !pressed(pad, index)) && vector.x === 0 && vector.y === 0;
      if (this.neutralReady) {this.releaseGate = false;}
      return;
    }
    if (!this.enabled) {return;}
    if (vector.x || vector.y) {
      this.move(vector, elapsed * (pressed(pad, 4) ? 0.2 : 1));
    }
    this.updateButton(0, pressed(pad, 0));
    this.updateButton(2, pressed(pad, 1));
    this.surface.refresh(this.position);
    if (this.held || vector.x || vector.y) {this.surface.reveal(this.position);}
  }

  private move(vector: CursorPosition, elapsed: number) {
    const bounds = this.surface.bounds();
    const length = Math.max(1, Math.hypot(vector.x, vector.y));
    this.position = {
      x: clamp(this.position.x + vector.x / length * 0.75 * elapsed / Math.max(1, bounds.width)),
      y: clamp(this.position.y + vector.y / length * 0.75 * elapsed / Math.max(1, bounds.height)),
    };
    for (const [button, start] of this.downAt) {
      if (Math.hypot((this.position.x - start.x) * bounds.width, (this.position.y - start.y) * bounds.height) > 4) {
        this.dragged.add(button);
      }
    }
    this.surface.reveal(this.position);
    this.surface.send("mousemove", 0, this.held, this.position);
  }

  private updateButton(button: number, next: boolean) {
    const mask = button === 0 ? 1 : 2;
    if (Boolean(this.held & mask) === next) {return;}
    this.surface.reveal(this.position);
    this.held = next ? this.held | mask : this.held & ~mask;
    this.surface.send(next ? "mousedown" : "mouseup", button, this.held, this.position);
    if (next) {this.downAt.set(button, {...this.position}); return;}
    if (!this.dragged.has(button)) {
      this.surface.send(button === 0 ? "click" : "contextmenu", button, this.held, this.position);
    }
    this.downAt.delete(button); this.dragged.delete(button);
  }

  private reset() {
    for (const button of [0, 2]) {
      const mask = button === 0 ? 1 : 2;
      if (!(this.held & mask)) {continue;}
      this.held &= ~mask;
      this.surface.send("mouseup", button, this.held, this.position);
    }
    this.downAt.clear(); this.dragged.clear();
    this.neutralReady = false; this.previousTime = null;
    this.surface.hide();
  }
}

function pressed(pad: Gamepad, index: number) {return Boolean(pad.buttons[index]?.pressed || pad.buttons[index]?.value >= 0.5);}
function axis(value: number) {
  return !Number.isFinite(value) || Math.abs(value) <= 0.2 ? 0 : Math.sign(value) * (Math.abs(value) - 0.2) / 0.8;
}
function direction(pad: Gamepad) {
  return {
    x: Number(pressed(pad, 15)) - Number(pressed(pad, 14)) || axis(pad.axes[0] ?? 0),
    y: Number(pressed(pad, 13)) - Number(pressed(pad, 12)) || axis(pad.axes[1] ?? 0),
  };
}
function clamp(value: number) {return Math.max(0, Math.min(1, value));}
