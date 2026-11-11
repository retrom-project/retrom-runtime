import type {EjsWindow} from "./emulator-instance.js";

type Point = {x: number; y: number};
/** `analog` zones send proportional right/left/down/up; D-pads send up/down/left/right at `pressValue`. */
type Stick = {element: HTMLElement; inputValues: number[]; analog: boolean; pressValue: number};
type Placed = Stick & {surface: HTMLElement};
type Active = {stick: Placed; origin: Point; held: number[]};

const maxAnalog = 0x7fff;
const rimRadius = 50;

/** EJS input slots of a left-hand direction control, from the configured layout or both pinned default layouts. */
function stickInputs(runtimeWindow: EjsWindow, element: HTMLElement): Omit<Stick, "element"> | null {
  const id = [...element.classList].find(name => name.startsWith("b_"))?.slice(2);
  if (!id) {return null;}
  const configured = runtimeWindow.EJS_VirtualGamepadSettings?.find(item => item.id === id && item.type !== "button");
  if (configured?.inputValues?.length === 4) {
    const joystick = configured.joystickInput === true;
    return {inputValues: configured.inputValues, analog: joystick && configured.type === "zone",
      pressValue: joystick && configured.type === "dpad" ? maxAnalog : 1};
  }
  if (runtimeWindow.EJS_VirtualGamepadSettings) {return null;}
  if (["dpad", "left_dpad", "x_dpad"].includes(id)) {return {inputValues: [4, 5, 6, 7], analog: false, pressValue: 1};}
  if (id === "stick") {return {inputValues: [16, 17, 18, 19], analog: true, pressValue: maxAnalog};}
  return null;
}

/** Up/down/left/right flags for an offset with screen y growing downward: 8 sectors outside a quarter-radius dead zone. */
export function floatingDirections(dx: number, dy: number, radius: number): [boolean, boolean, boolean, boolean] {
  if (!(radius > 0) || Math.hypot(dx, dy) < radius * .25) {return [false, false, false, false];}
  const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return [sector >= 5 && sector <= 7, sector >= 1 && sector <= 3, sector >= 3 && sector <= 5, sector === 7 || sector <= 1];
}

/**
 * Floating left stick for the EmulatorJS virtual gamepad: the touch-down point becomes the stick centre and directions
 * come from the finger's travel, so landing off-centre never moves the game. Touches are claimed in the capture phase
 * before EmulatorJS or nipplejs see them; mouse input keeps the native fixed controls.
 */
export function installFloatingStick(ejsWindow: EjsWindow, options: {wideZone: boolean}) {
  const runtimeWindow = ejsWindow as EjsWindow & typeof globalThis;
  const document = runtimeWindow.document;
  let active: Active | null = null;
  let pointerId: number | null = null;
  let zone: HTMLElement | null = null;

  // A D-pad's wrapper has no height; its absolutely positioned pad is what is drawn and touched.
  const sticks = (): Placed[] => [...document.querySelectorAll<HTMLElement>(".ejs_virtualGamepad_left > [class*='b_']")]
    .flatMap(element => {
      const inputs = stickInputs(runtimeWindow, element);
      return inputs ? [{element, surface: element.querySelector<HTMLElement>(".ejs_dpad_main") ?? element, ...inputs}] : [];
    });
  const send = (input: number, value: number) => runtimeWindow.EJS_emulator?.gameManager?.simulateInput?.(0, input, value);
  const restCentre = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const x = parseFloat(element.style.getPropertyValue("--retrom-float-x")) || 0;
    const y = parseFloat(element.style.getPropertyValue("--retrom-float-y")) || 0;
    return {x: bounds.left + bounds.width / 2 - x, y: bounds.top + bounds.height / 2 - y,
      radius: Math.min(rimRadius, bounds.width / 2)};
  };
  const place = (stick: Placed, origin: Point | null, knob: Point = {x: 0, y: 0}) => {
    const {element, surface} = stick;
    element.classList.toggle("retrom-floating-active", origin !== null);
    if (!origin) {
      for (const name of ["--retrom-float-x", "--retrom-float-y", "translate"]) {surface.style.removeProperty(name);}
    } else {
      const rest = restCentre(surface), x = origin.x - rest.x, y = origin.y - rest.y;
      surface.style.setProperty("--retrom-float-x", `${x}px`); surface.style.setProperty("--retrom-float-y", `${y}px`);
      surface.style.setProperty("translate", `${x}px ${y}px`);
    }
    const dpad = element.querySelector<HTMLElement>(".ejs_dpad_main");
    const front = element.querySelector<HTMLElement>(".nipple .front");
    for (const [axis, value] of [["x", knob.x], ["y", knob.y]] as const) {
      if (value === 0) {dpad?.style.removeProperty(`--retrom-stick-${axis}`);}
      else {dpad?.style.setProperty(`--retrom-stick-${axis}`, `${value}px`);}
    }
    if (front) {front.style.transform = `translate(${knob.x}px,${knob.y}px)`;}
  };
  const update = (point: Point) => {
    if (!active) {return;}
    const {stick, origin} = active;
    const radius = restCentre(stick.surface).radius;
    let dx = point.x - origin.x, dy = point.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (radius > 0 && distance > radius) {
      const excess = (distance - radius) / distance;
      origin.x += dx * excess; origin.y += dy * excess;
      dx = point.x - origin.x; dy = point.y - origin.y;
    }
    place(stick, origin, {x: dx, y: dy});
    if (runtimeWindow.EJS_emulator?.paused) {release(); return;}
    if (stick.analog) {
      const scale = radius > 0 ? 1 / radius : 0;
      const x = Math.hypot(dx, dy) < radius * .15 ? 0 : dx * scale, y = Math.hypot(dx, dy) < radius * .15 ? 0 : dy * scale;
      const [right, left, down, up] = stick.inputValues;
      send(right, x > 0 ? maxAnalog * x : 0); send(left, x < 0 ? maxAnalog * -x : 0);
      send(down, y > 0 ? maxAnalog * y : 0); send(up, y < 0 ? maxAnalog * -y : 0);
      return;
    }
    const flags = floatingDirections(dx, dy, radius);
    const next = stick.inputValues.filter((_input, index) => flags[index]);
    // Release first, so a reversal never delivers opposite directions together.
    for (const input of active.held) {if (!next.includes(input)) {send(input, 0);}}
    for (const input of next) {if (!active.held.includes(input)) {send(input, stick.pressValue);}}
    active.held = next;
  };
  const release = () => {
    if (!active) {return;}
    const {stick, held} = active;
    active = null; pointerId = null;
    if (stick.analog) {for (const input of stick.inputValues) {send(input, 0);}}
    else {for (const input of held) {send(input, 0);}}
    place(stick, null);
  };

  const claimed = (target: EventTarget | null) => {
    const element = target instanceof runtimeWindow.Element ? target : null;
    if (!element) {return null;}
    if (zone && element === zone) {return "zone" as const;}
    const stick = sticks().find(candidate => candidate.element.contains(element as Node));
    // The left pad's empty area around the drawn stick belongs to the stick too.
    return stick ?? (element.classList.contains("ejs_virtualGamepad_left") ? "zone" as const : null);
  };
  const nearest = (point: Point) => sticks().map(stick => {
    const rest = restCentre(stick.surface);
    return {stick, distance: Math.hypot(point.x - rest.x, point.y - rest.y)};
  }).sort((left, right) => left.distance - right.distance)[0]?.stick ?? null;
  const swallow = (event: Event) => {event.preventDefault(); event.stopImmediatePropagation();};
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") {return;}
    const target = claimed(event.target);
    if (!target) {return;}
    swallow(event);
    if (active) {return;}
    const point = {x: event.clientX, y: event.clientY};
    const stick = target === "zone" ? nearest(point) : target;
    if (!stick) {return;}
    active = {stick, origin: point, held: []}; pointerId = event.pointerId;
    place(stick, point);
  };
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) {return;}
    swallow(event); update({x: event.clientX, y: event.clientY});
  };
  const pointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) {return;}
    swallow(event); release();
  };
  // EmulatorJS's native D-pad listens to touch events; keep them away from every claimed control.
  const touch = (event: TouchEvent) => {
    if (Array.from(event.changedTouches).some(point => claimed(point.target))) {swallow(event);}
  };
  const visibility = () => {if (document.hidden) {release();}};
  document.addEventListener("pointerdown", pointerDown, true);
  document.addEventListener("pointermove", pointerMove, true);
  for (const type of ["pointerup", "pointercancel"] as const) {document.addEventListener(type, pointerEnd, true);}
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
    document.addEventListener(type, touch, {capture: true, passive: false});
  }
  runtimeWindow.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);

  // The lower-left zone sits first inside the virtual gamepad so every EmulatorJS button stays on top of it.
  const attachZone = () => {
    const parent = document.querySelector(".ejs_virtualGamepad_parent");
    if (!options.wideZone || !parent || (zone && zone.parentElement === parent)) {return;}
    zone ??= document.createElement("div");
    zone.className = "retrom-floating-stick-zone";
    parent.prepend(zone);
  };
  const observer = new runtimeWindow.MutationObserver(attachZone);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  attachZone();

  return {release, dispose: () => {
    release(); observer.disconnect(); zone?.remove(); zone = null;
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("pointermove", pointerMove, true);
    for (const type of ["pointerup", "pointercancel"] as const) {document.removeEventListener(type, pointerEnd, true);}
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {document.removeEventListener(type, touch, true);}
    runtimeWindow.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", visibility);
  }};
}

/** The zone stays beneath the gamepad buttons and short of the centre Start/Select row. */
export const floatingStickStyle = `
.retrom-floating-stick-zone{position:fixed;left:0;bottom:0;width:min(40vw,calc(50vw - 70px));height:65vh;touch-action:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.retrom-floating-active .ejs_dpad_main{opacity:1}
`;
