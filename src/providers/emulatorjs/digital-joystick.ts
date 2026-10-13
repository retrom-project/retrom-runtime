import type {EjsWindow} from "./emulator-instance.js";

type Motion = {angle: {degree: number}; distance: number};
type Listener = (event: unknown, motion: Motion) => void;
type Collection = {
  on: (event: string, listener: Listener) => unknown;
  off: (event: string, listener: Listener) => unknown;
};
type JoystickFactory = {create: (options: {zone: HTMLElement}) => Collection};

function digitalInputs(runtimeWindow: EjsWindow, zone: HTMLElement) {
  const configured = runtimeWindow.EJS_VirtualGamepadSettings;
  if (configured) {
    const control = configured.find(item => item.type === "zone" && zone.classList.contains(`b_${item.id}`));
    return control && !control.joystickInput && control.inputValues?.length === 4 ? control.inputValues : null;
  }
  // Both pinned EJS layouts name their digital libretro pad "dpad". Analog
  // zones ("stick", etc.) retain EJS's native axis handling and configuration.
  return zone.classList.contains("b_dpad") ? [4, 5, 6, 7] : null;
}

function bindDigitalZone(collection: Collection, inputs: number[], runtimeWindow: EjsWindow) {
  let pressed = new Set<number>();
  let disposed = false;
  const update = (next: Set<number>) => {
    const manager = runtimeWindow.EJS_emulator?.gameManager;
    if (!manager?.simulateInput) {pressed.clear(); return;}
    // Release first, so even a reversal never delivers opposite directions.
    for (const input of pressed) {if (!next.has(input)) {manager.simulateInput(0, input, 0);}}
    for (const input of next) {if (!pressed.has(input)) {manager.simulateInput(0, input, 1);}}
    pressed = next;
  };
  const release = () => update(new Set());
  const move: Listener = (_event, motion) => {
    if (disposed) {return;}
    if (runtimeWindow.EJS_emulator?.paused || motion.distance === 0) {release(); return;}
    const d = motion.angle.degree;
    const directions = [d >= 30 && d < 150, d >= 210 && d < 330, d >= 120 && d < 240, d >= 300 || d < 60];
    update(new Set(inputs.filter((_input, index) => directions[index])));
  };
  const on = collection.on;
  const pending = new Map<string, Listener>([["move", move], ["end", release]]);
  // EJS registers these two handlers immediately after create(). Own only
  // their digital input translation; nipplejs still owns touch/multitouch,
  // pointer cancellation, geometry and visuals. Later subscribers pass through.
  const register: Collection["on"] = function (this: Collection, event, listener) {
    const replacement = pending.get(event);
    pending.delete(event);
    const result = on.call(this, event, replacement ?? listener);
    if (pending.size === 0) {collection.on = on;}
    return result;
  };
  collection.on = register;
  return {release, dispose: () => {
    if (disposed) {return;}
    disposed = true; release();
    collection.off("move", move); collection.off("end", release);
    if (collection.on === register) {collection.on = on;}
  }};
}

export function installDigitalJoysticks(runtimeWindow: EjsWindow) {
  const target = runtimeWindow as EjsWindow & {nipplejs?: JoystickFactory};
  const descriptor = Object.getOwnPropertyDescriptor(target, "nipplejs");
  if (descriptor && !descriptor.configurable) {throw new Error("PLAYER_RUNTIME_INPUT_UNAVAILABLE");}
  const zones: ReturnType<typeof bindDigitalZone>[] = [];
  const factories = new Map<JoystickFactory, JoystickFactory["create"]>();
  const release = () => {for (const zone of zones) {zone.release();}};
  const attach = (factory: JoystickFactory | undefined) => {
    if (!factory || factories.has(factory)) {return;}
    const create = factory.create;
    factories.set(factory, create);
    factory.create = function (options) {
      const collection = create.call(this, options);
      const inputs = digitalInputs(runtimeWindow, options.zone);
      if (inputs) {zones.push(bindDigitalZone(collection, inputs, runtimeWindow));}
      return collection;
    };
  };
  // EJS constructs the controls before its ready callback. Observe the vendor
  // assignment before loading EJS, and resolve the eventual instance on input.
  let current = target.nipplejs;
  attach(current);
  Object.defineProperty(target, "nipplejs", {configurable: true, enumerable: descriptor?.enumerable ?? true,
    get: () => current, set: (factory: JoystickFactory | undefined) => {attach(factory); current = factory;}});
  const visibility = () => {if (runtimeWindow.document.hidden) {release();}};
  runtimeWindow.addEventListener("blur", release);
  runtimeWindow.document.addEventListener("visibilitychange", visibility);
  return {release, dispose: () => {
    for (const zone of zones) {zone.dispose();}
    zones.length = 0;
    for (const [factory, create] of factories) {factory.create = create;}
    factories.clear();
    if (descriptor) {Object.defineProperty(target, "nipplejs", descriptor);}
    else {Reflect.deleteProperty(target, "nipplejs");}
    runtimeWindow.removeEventListener("blur", release);
    runtimeWindow.document.removeEventListener("visibilitychange", visibility);
  }};
}
