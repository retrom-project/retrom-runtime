import type {TouchGamepadOptions} from "./touch-gamepad-layout.js";

export type StickPoint = {x: number; y: number};

/** The lower-left zone of a floating stick, added before every control so they all stay above it. */
export function createStickZone(document: Document, root: HTMLElement, options: TouchGamepadOptions) {
  const stickMode = options.stickMode ?? "FLOATING";
  root.dataset.stickMode = stickMode;
  if (stickMode !== "FLOATING" || !(options.wideStickZone ?? options.layout !== "POINTER")) {return null;}
  const zone = document.createElement("div");
  zone.dataset.control = "stick-zone";
  root.append(zone);
  return zone;
}

/** Resting geometry and floating placement of on-screen sticks; the drawn stick follows a floating origin. */
export function floatingSticks(frameWindow: Window) {
  const floats = new Map<HTMLElement, StickPoint>();
  /** Resting centre of a stick, independent of any floating offset currently applied. */
  const restCentre = (control: HTMLElement) => {
    const bounds = control.getBoundingClientRect();
    const offset = floats.get(control) ?? {x: 0, y: 0};
    return {x: bounds.left + bounds.width / 2 - offset.x, y: bounds.top + bounds.height / 2 - offset.y, radius: bounds.width / 2};
  };
  /** Moves the drawn stick so its centre sits on a floating origin, or back to rest without one. */
  const floatTo = (control: HTMLElement, origin?: StickPoint) => {
    if (!origin) {
      floats.delete(control);
      control.style.removeProperty("--float-x"); control.style.removeProperty("--float-y");
      return;
    }
    const rest = restCentre(control), offset = {x: origin.x - rest.x, y: origin.y - rest.y};
    floats.set(control, offset);
    control.style.setProperty("--float-x", `${offset.x}px`); control.style.setProperty("--float-y", `${offset.y}px`);
  };
  /** Offset of a point from the stick centre; a floating origin is dragged along once the finger passes the rim. */
  const offset = (point: StickPoint, control: HTMLElement, origin?: StickPoint) => {
    const rest = restCentre(control);
    if (!origin) {return {dx: point.x - rest.x, dy: point.y - rest.y, radius: rest.radius};}
    let dx = point.x - origin.x, dy = point.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (rest.radius > 0 && distance > rest.radius) {
      const excess = (distance - rest.radius) / distance;
      origin.x += dx * excess; origin.y += dy * excess;
      dx = point.x - origin.x; dy = point.y - origin.y;
      floatTo(control, origin);
    }
    return {dx, dy, radius: rest.radius};
  };
  /** The visible stick whose resting centre is closest to a zone touch. */
  const nearest = (point: StickPoint, controls: readonly (HTMLElement | null)[]) => controls
    .filter((control): control is HTMLElement => control !== null && frameWindow.getComputedStyle(control).display !== "none")
    .map(control => {const rest = restCentre(control); return {control, distance: Math.hypot(point.x - rest.x, point.y - rest.y)};})
    .sort((left, right) => left.distance - right.distance)[0]?.control ?? null;
  return {floatTo, offset, nearest};
}
