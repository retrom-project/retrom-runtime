import {inputObserver} from "./input-observations.js";

export type CursorPosition = {x: number; y: number};
export type CursorMouseAction = "mousemove" | "mousedown" | "mouseup" | "click" | "contextmenu";

/** Core differences stop at the event protocol and the actual input element. */
export function createCursorSurface(frameWindow: Window, target: HTMLElement, protocol: "mouse" | "pointer") {
  const document = frameWindow.document;
  const cursor = document.createElement("div");
  cursor.dataset.gamepadCursor = "";
  cursor.hidden = true;
  cursor.setAttribute("aria-hidden", "true");
  Object.assign(cursor.style, {
    position: "fixed", width: "14px", height: "14px", borderRadius: "50%",
    background: "rgba(255,255,255,.92)", border: "2px solid rgba(10,10,14,.9)",
    boxShadow: "0 0 0 2px rgba(255,255,255,.6)", pointerEvents: "none",
    transform: "translate(-50%, -50%)", zIndex: "2147483647",
  });
  document.body.append(cursor);
  const point = (position: CursorPosition) => {
    const bounds = target.getBoundingClientRect();
    return {clientX: bounds.left + position.x * bounds.width, clientY: bounds.top + position.y * bounds.height};
  };
  const positionCursor = (position: CursorPosition) => {
    const {clientX, clientY} = point(position);
    cursor.style.left = `${clientX}px`; cursor.style.top = `${clientY}px`;
  };
  const boundary = (type: "pointerenter" | "pointerleave", position: CursorPosition) => {
    if (protocol !== "pointer") {return;}
    const realm = frameWindow as Window & {PointerEvent: typeof PointerEvent};
    target.dispatchEvent(new realm.PointerEvent(type, {...point(position), pointerId: 1, pointerType: "mouse", isPrimary: true}));
  };
  let lastPosition: CursorPosition = {x: 0.5, y: 0.5};
  return {
    bounds: () => target.getBoundingClientRect(),
    hide: () => {if (!cursor.hidden) {boundary("pointerleave", lastPosition);} cursor.hidden = true;},
    dispose: () => cursor.remove(),
    refresh: (position: CursorPosition) => {if (!cursor.hidden) {positionCursor(position);}},
    reveal: (position: CursorPosition) => {
      if (cursor.hidden) {boundary("pointerenter", position);}
      lastPosition = position;
      positionCursor(position); cursor.hidden = false;
    },
    send: (type: CursorMouseAction, button: number, buttons: number, position: CursorPosition) => {
      const realm = frameWindow as Window & {MouseEvent: typeof MouseEvent; PointerEvent: typeof PointerEvent};
      const options = {bubbles: true, composed: true, cancelable: true, button, buttons, ...point(position)};
      if (type === "mousedown") {target.focus({preventScroll: true});}
      if (protocol === "pointer" && type.startsWith("mouse")) {
        target.dispatchEvent(new realm.PointerEvent(type.replace("mouse", "pointer"), {
          ...options, pointerId: 1, pointerType: "mouse", isPrimary: true,
        }));
      } else {target.dispatchEvent(new realm.MouseEvent(type, options));}
      if (type === "mousedown" || type === "mouseup") {
        inputObserver(frameWindow)?.record({device: "gamepad", control: `Button ${button === 0 ? 0 : 1}`,
          value: type === "mousedown" ? 1 : 0, stage: "DELIVERED",
          target: button === 0 ? "MouseLeft" : "MouseRight", reason: null}, frameWindow.performance.now());
      }
    },
  };
}
