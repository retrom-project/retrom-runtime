import type {RuntimeGamepadCursorV1, RuntimeInputFilterPolicyV1} from "./module-api.js";
import {createCursorSurface, type CursorPosition} from "./gamepad-cursor-surface.js";
import {captureGamepadSource} from "./gamepad-filter.js";

const ownedButtons = [0, 1, 4, 12, 13, 14, 15];
type CursorOptions = {
  defaultEnabled: boolean;
  protocol?: "mouse" | "pointer";
  /** A dedicated source owns its own inputs and leaves native gamepads untouched. */
  readGamepads?: () => (Gamepad | null)[];
  hitTest?: boolean;
  activationEvent?: "click" | "tap";
};
export type GamepadCursor = RuntimeGamepadCursorV1 & {
  readNativeGamepads(): (Gamepad | null)[];
  setNativeOwned(owned: boolean): void;
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
  private nativeOwned = false;
  private nativeReady = false;
  private nativeDrainReserved = false;
  private nativeSnapshot: (Gamepad | null)[] | undefined;
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
    this.readGamepads = options.readGamepads ?? captureGamepadSource(window);
    if (!options.readGamepads && this.descriptor && !this.descriptor.configurable) {
      throw new Error("PLAYER_INPUT_FILTER_UNAVAILABLE");
    }
    this.surface = createCursorSurface(window, target, options.protocol ?? "mouse", options.hitTest, options.activationEvent);
    if (!options.readGamepads) {Object.defineProperty(navigator, "getGamepads", {configurable: true, value: this.filteredGamepads});}
    window.addEventListener("blur", this.blur);
    window.addEventListener("focus", this.focus);
    window.document.addEventListener("visibilitychange", this.visibility);
    this.frame = window.requestAnimationFrame(this.poll);
  }

  getState() {return {enabled: this.enabled, defaultEnabled: this.options.defaultEnabled};}

  readNativeGamepads() {
    if (this.disposed) {return [];}
    this.nativeSnapshot ??= this.filteredGamepads().map(pad => pad ? {
      id: pad.id, index: pad.index, connected: pad.connected, mapping: pad.mapping, timestamp: pad.timestamp,
      vibrationActuator: pad.vibrationActuator, axes: [...pad.axes],
      buttons: pad.buttons.map(({pressed, touched, value}) => ({pressed, touched, value})),
    } : null);
    return this.nativeSnapshot;
  }

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
    this.nativeReady = false;
    this.reset();
  }

  setNativeOwned(owned: boolean) {
    if (this.disposed || this.nativeOwned === owned) {return;}
    this.reset();
    this.nativeOwned = owned;
    this.nativeReady = false;
    this.releaseGate = true;
  }

  setInputPolicy(policy: RuntimeInputFilterPolicyV1 | null) {
    if (policy?.activeGamepadIndex !== this.policy?.activeGamepadIndex || policy?.suppressInput !== this.policy?.suppressInput) {
      this.reset();
      this.activeIndex = null;
      this.nativeReady = false;
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

  private readonly blur = () => {this.unfocused = true; this.nativeReady = false; this.reset();};
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
    if (this.nativeOwned) {return this.filteredNativeGamepads(pads, selected);}
    if ((!this.enabled && !this.releaseGate) || !selected) {return pads;}
    return pads.map(pad => pad !== selected ? pad : {
      id: pad.id, index: pad.index, connected: pad.connected, mapping: pad.mapping, timestamp: pad.timestamp, vibrationActuator: pad.vibrationActuator,
      axes: pad.axes.map((value, index) => index < 2 ? 0 : value),
      buttons: pad.buttons.map((button, index) => ownedButtons.includes(index)
        ? {pressed: false, touched: false, value: 0}
        : {pressed: button.pressed, touched: button.touched, value: button.value}),
    });
  };

  private filteredNativeGamepads(pads: (Gamepad | null)[], selected: Gamepad | null) {
    if (this.blocked()) {return pads.map(pad => pad ? maskedGamepad(pad) : null);}
    if (!selected) {return pads;}
    if (!this.nativeReady) {return pads.map(pad => pad !== selected ? pad : maskedGamepad(pad));}
    if (!this.nativeDrainReserved) {return pads;}
    this.nativeDrainReserved = false;
    // A short Start/Select release becomes a filtered pulse. Drain the pulse
    // from the neutral gate without discarding a new physical button press.
    const raw = this.select(this.sample());
    return pads.map(pad => pad !== selected ? pad : {
      ...maskedGamepad(pad), axes: pad.axes,
      buttons: pad.buttons.map((button, index) => (index === 8 || index === 9) && (!raw || !pressed(raw, index))
        ? {pressed: false, touched: false, value: 0} : button),
    });
  }

  private readonly poll = (time: number) => {
    if (this.disposed) {return;}
    this.nativeSnapshot = undefined;
    this.update(time);
    this.frame = this.window.requestAnimationFrame(this.poll);
  };

  private update(time: number) {
    const elapsed = this.previousTime === null ? 0 : Math.max(0, Math.min(50, time - this.previousTime));
    this.previousTime = time;
    const pad = this.select(this.sample());
    if (!pad) {this.reset(); this.activeIndex = null; return;}
    if (this.activeIndex !== pad.index) {this.reset(); this.nativeReady = false; this.activeIndex = pad.index;}
    if (this.nativeOwned) {this.updateNative(pad); return;}
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

  private updateNative(pad: Gamepad) {
    const ready = !this.blocked() && (this.nativeReady || neutralGamepad(pad));
    if (ready && !this.nativeReady) {this.nativeDrainReserved = true;}
    this.nativeReady = ready;
    this.reset();
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
    // SDL and other consumers cache position from motion events. A physical
    // pointer may have moved since the last pad movement, including at startup.
    this.surface.send("mousemove", 0, this.held, this.position);
    this.held = next ? this.held | mask : this.held & ~mask;
    this.surface.send(next ? "mousedown" : "mouseup", button, this.held, this.position);
    if (next) {this.downAt.set(button, {...this.position}); return;}
    if (!this.dragged.has(button)) {
      this.surface.send(button === 0 ? "click" : "contextmenu", button, this.held, this.position);
    }
    this.downAt.delete(button); this.dragged.delete(button);
  }

  private reset() {
    this.nativeSnapshot = undefined;
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
function neutralGamepad(pad: Gamepad) {
  return pad.buttons.every(button => !button.pressed && button.value < 0.5) &&
    pad.axes.every(value => Number.isFinite(value) && Math.abs(value) <= 0.2);
}
function maskedGamepad(pad: Gamepad): Gamepad {
  return {
    id: pad.id, index: pad.index, connected: pad.connected, mapping: pad.mapping, timestamp: pad.timestamp,
    vibrationActuator: pad.vibrationActuator,
    axes: pad.axes.map(() => 0), buttons: pad.buttons.map(() => ({pressed: false, touched: false, value: 0})),
  };
}
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
