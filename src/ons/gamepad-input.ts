const pressThreshold = 0.6;
const releaseThreshold = 0.35;

type DirectionKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp";
type KeyboardEventWindow = Window & { KeyboardEvent: typeof KeyboardEvent };

export function installOnsAnalogGamepad(frameWindow: Window, canvas: HTMLCanvasElement) {
  let frame = 0;
  let pressed = new Set<DirectionKey>();
  const poll = () => {
    const next = readDirections(frameWindow.navigator, pressed);
    dispatchChanges(frameWindow, canvas, pressed, next);
    pressed = next;
    frame = frameWindow.requestAnimationFrame(poll);
  };
  frame = frameWindow.requestAnimationFrame(poll);
  return () => {
    frameWindow.cancelAnimationFrame(frame);
    dispatchChanges(frameWindow, canvas, pressed, new Set());
    pressed.clear();
  };
}

function readDirections(navigator: Navigator, previous: ReadonlySet<DirectionKey>) {
  const directions = new Set<DirectionKey>();
  const gamepad = typeof navigator.getGamepads === "function"
    ? [...navigator.getGamepads()].find((candidate) => candidate?.connected && candidate.mapping === "standard")
    : null;
  if (!gamepad || gamepad.axes.length < 2) {return directions;}
  selectAxis(gamepad.axes[0], "ArrowLeft", "ArrowRight", previous, directions);
  selectAxis(gamepad.axes[1], "ArrowUp", "ArrowDown", previous, directions);
  return directions;
}

function selectAxis(
  value: number,
  negative: DirectionKey,
  positive: DirectionKey,
  previous: ReadonlySet<DirectionKey>,
  directions: Set<DirectionKey>,
) {
  if (!Number.isFinite(value)) {return;}
  if (value <= -pressThreshold || previous.has(negative) && value < -releaseThreshold) {directions.add(negative);}
  if (value >= pressThreshold || previous.has(positive) && value > releaseThreshold) {directions.add(positive);}
}

function dispatchChanges(
  frameWindow: Window,
  canvas: HTMLCanvasElement,
  previous: ReadonlySet<DirectionKey>,
  next: ReadonlySet<DirectionKey>,
) {
  for (const key of previous) {if (!next.has(key)) {dispatchKey(frameWindow, canvas, "keyup", key);}}
  for (const key of next) {if (!previous.has(key)) {dispatchKey(frameWindow, canvas, "keydown", key);}}
}

function dispatchKey(frameWindow: Window, canvas: HTMLCanvasElement, type: "keydown" | "keyup", key: DirectionKey) {
  if (type === "keydown") {canvas.focus({ preventScroll: true });}
  canvas.dispatchEvent(new (frameWindow as KeyboardEventWindow).KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code: key,
    key,
  }));
}
