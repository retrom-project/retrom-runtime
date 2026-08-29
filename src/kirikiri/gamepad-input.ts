const axisDeadZone = 0.2;
const buttonPressThreshold = 0.5;
const cursorSpeedPixelsPerMs = 0.75;
const maximumFrameDurationMs = 50;

type ButtonState = { primary: boolean; secondary: boolean };
type MouseEventWindow = Window & { MouseEvent: typeof MouseEvent };

export function installKirikiriStandardGamepad(
  frameWindow: Window,
  surface: HTMLElement,
  canvas: HTMLCanvasElement,
) {
  const cursor = createCursor(frameWindow.document);
  surface.style.position = "relative";
  surface.append(cursor);
  let frame = 0;
  let previousTimestamp: number | null = null;
  let position = { x: 0.5, y: 0.5 };
  let buttons: ButtonState = { primary: false, secondary: false };
  const poll = (timestamp: number) => {
    const gamepad = standardGamepad(frameWindow.navigator);
    const elapsed = previousTimestamp === null ? 0 : Math.min(maximumFrameDurationMs, Math.max(0, timestamp - previousTimestamp));
    previousTimestamp = timestamp;
    if (!gamepad) {
      releaseButtons(frameWindow, canvas, position, buttons);
      buttons = { primary: false, secondary: false };
      cursor.hidden = true;
    } else {
      const vector = directionVector(gamepad);
      if (vector.x !== 0 || vector.y !== 0) {
        position = movePosition(canvas, position, vector, elapsed);
        revealCursor(surface, canvas, cursor, position);
        dispatchMouse(frameWindow, canvas, "mousemove", 0, 0, position);
      }
      const next = readButtons(gamepad);
      updateButton(frameWindow, canvas, cursor, surface, position, "primary", buttons.primary, next.primary);
      updateButton(frameWindow, canvas, cursor, surface, position, "secondary", buttons.secondary, next.secondary);
      buttons = next;
    }
    frame = frameWindow.requestAnimationFrame(poll);
  };
  frame = frameWindow.requestAnimationFrame(poll);
  return () => {
    frameWindow.cancelAnimationFrame(frame);
    releaseButtons(frameWindow, canvas, position, buttons);
    cursor.remove();
  };
}

function createCursor(document: Document) {
  const cursor = document.createElement("div");
  cursor.dataset.kirikiriGamepadCursor = "";
  cursor.hidden = true;
  Object.assign(cursor.style, {
    background: "rgba(255,255,255,.92)",
    border: "2px solid rgba(10,10,14,.9)",
    borderRadius: "50%",
    boxShadow: "0 0 0 2px rgba(255,255,255,.6)",
    height: "14px",
    left: "0",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    transform: "translate(-50%, -50%)",
    width: "14px",
    zIndex: "2",
  });
  return cursor;
}

function standardGamepad(navigator: Navigator) {
  if (typeof navigator.getGamepads !== "function") {return null;}
  return [...navigator.getGamepads()].find((candidate) =>
    candidate?.connected && candidate.mapping === "standard",
  ) ?? null;
}

function directionVector(gamepad: Gamepad) {
  return {
    x: digitalAxis(gamepad, 14, 15) ?? analogAxis(gamepad.axes[0] ?? 0),
    y: digitalAxis(gamepad, 12, 13) ?? analogAxis(gamepad.axes[1] ?? 0),
  };
}

function digitalAxis(gamepad: Gamepad, negative: number, positive: number) {
  const low = buttonPressed(gamepad.buttons[negative]);
  const high = buttonPressed(gamepad.buttons[positive]);
  if (low === high) {return null;}
  return low ? -1 : 1;
}

function analogAxis(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) <= axisDeadZone) {return 0;}
  return Math.sign(value) * (Math.abs(value) - axisDeadZone) / (1 - axisDeadZone);
}

function movePosition(
  canvas: HTMLCanvasElement,
  current: { x: number; y: number },
  vector: { x: number; y: number },
  elapsed: number,
) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  return {
    x: clamp(current.x + vector.x * cursorSpeedPixelsPerMs * elapsed / width),
    y: clamp(current.y + vector.y * cursorSpeedPixelsPerMs * elapsed / height),
  };
}

function clamp(value: number) {return Math.max(0, Math.min(1, value));}

function readButtons(gamepad: Gamepad): ButtonState {
  return { primary: buttonPressed(gamepad.buttons[0]), secondary: buttonPressed(gamepad.buttons[1]) };
}

function buttonPressed(button: GamepadButton | undefined) {
  return Boolean(button && (button.pressed || button.value >= buttonPressThreshold));
}

function updateButton(
  frameWindow: Window,
  canvas: HTMLCanvasElement,
  cursor: HTMLElement,
  surface: HTMLElement,
  position: { x: number; y: number },
  button: keyof ButtonState,
  previous: boolean,
  next: boolean,
) {
  if (previous === next) {return;}
  revealCursor(surface, canvas, cursor, position);
  canvas.focus({ preventScroll: true });
  const code = button === "primary" ? 0 : 2;
  if (next) {
    dispatchMouse(frameWindow, canvas, "mousedown", code, code === 0 ? 1 : 2, position);
    return;
  }
  dispatchMouse(frameWindow, canvas, "mouseup", code, 0, position);
  dispatchMouse(frameWindow, canvas, button === "primary" ? "click" : "contextmenu", code, 0, position);
}

function releaseButtons(
  frameWindow: Window,
  canvas: HTMLCanvasElement,
  position: { x: number; y: number },
  buttons: ButtonState,
) {
  if (buttons.primary) {dispatchMouse(frameWindow, canvas, "mouseup", 0, 0, position);}
  if (buttons.secondary) {dispatchMouse(frameWindow, canvas, "mouseup", 2, 0, position);}
}

function revealCursor(
  surface: HTMLElement,
  canvas: HTMLCanvasElement,
  cursor: HTMLElement,
  position: { x: number; y: number },
) {
  const canvasBounds = canvas.getBoundingClientRect();
  const surfaceBounds = surface.getBoundingClientRect();
  cursor.hidden = false;
  cursor.style.left = `${canvasBounds.left - surfaceBounds.left + position.x * canvasBounds.width}px`;
  cursor.style.top = `${canvasBounds.top - surfaceBounds.top + position.y * canvasBounds.height}px`;
}

function dispatchMouse(
  frameWindow: Window,
  canvas: HTMLCanvasElement,
  type: "click" | "contextmenu" | "mousedown" | "mousemove" | "mouseup",
  button: number,
  buttons: number,
  position: { x: number; y: number },
) {
  const bounds = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new (frameWindow as MouseEventWindow).MouseEvent(type, {
    bubbles: true,
    button,
    buttons,
    cancelable: true,
    clientX: bounds.left + position.x * bounds.width,
    clientY: bounds.top + position.y * bounds.height,
  }));
}
