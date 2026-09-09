const keys = {
  ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39],
  Space: [" ", 32], Escape: ["Escape", 27], KeyX: ["x", 88], Enter: ["Enter", 13],
} as const;
type Key = keyof typeof keys;

export function installWebMSXGamepad(frameWindow: Window, canvas: HTMLCanvasElement) {
  let held = new Set<Key>(); let paused = false; let disposed = false; let frame = 0;
  const dispatch = (code: Key, type: "keydown" | "keyup") => {
    const [key, keyCode] = keys[code];
    if (type === "keydown") {canvas.focus({preventScroll: true});}
    const realm = frameWindow as Window & {KeyboardEvent: typeof KeyboardEvent};
    canvas.dispatchEvent(new realm.KeyboardEvent(type, {bubbles: true, composed: true, cancelable: true, key, code, keyCode}));
  };
  const change = (next: Set<Key>) => {
    for (const key of held) {if (!next.has(key)) {dispatch(key, "keyup");}}
    for (const key of next) {if (!held.has(key)) {dispatch(key, "keydown");}}
    held = next;
  };
  const poll = () => {
    if (disposed) {return;}
    let pad: Gamepad | null | undefined;
    try {pad = [...(frameWindow.navigator.getGamepads?.() ?? [])].find((entry) => entry?.connected && entry.mapping === "standard");}
    catch { /* Permissions Policy may disable gamepad access. */ }
    change(!paused && pad ? pressed(pad) : new Set());
    frame = frameWindow.requestAnimationFrame(poll);
  };
  frame = frameWindow.requestAnimationFrame(poll);
  return {
    pause: () => {paused = true; change(new Set());},
    resume: () => {paused = false;},
    dispose: () => {if (!disposed) {disposed = true; frameWindow.cancelAnimationFrame(frame); change(new Set());}},
  };
}

function pressed(pad: Gamepad) {
  const result = new Set<Key>();
  const button = (index: number) => Boolean(pad.buttons[index]?.pressed || pad.buttons[index]?.value >= 0.5);
  const axis = (index: number) => Number.isFinite(pad.axes[index]) ? pad.axes[index] : 0;
  if (button(12) || axis(1) <= -0.6) {result.add("ArrowUp");}
  if (button(13) || axis(1) >= 0.6) {result.add("ArrowDown");}
  if (button(14) || axis(0) <= -0.6) {result.add("ArrowLeft");}
  if (button(15) || axis(0) >= 0.6) {result.add("ArrowRight");}
  if (button(0)) {result.add("Space");}
  if (button(1)) {result.add("Escape");}
  if (button(2)) {result.add("KeyX");}
  if (button(3) || button(9)) {result.add("Enter");}
  return result;
}
