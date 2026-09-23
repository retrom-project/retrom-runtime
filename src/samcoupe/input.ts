type Key = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter" | "Escape";
const keyDetails: Record<Key, [string, number]> = {
  ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39],
  Enter: ["Enter", 13], Escape: ["Escape", 27],
};

export function samGamepadKeys(pad: Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons"> | null): Set<Key> {
  const keys = new Set<Key>();
  if (!pad?.connected || pad.mapping !== "standard") {return keys;}
  const button = (index: number) => Boolean(pad.buttons[index]?.pressed || pad.buttons[index]?.value >= 0.5);
  const axis = (index: number) => Number.isFinite(pad.axes[index]) ? pad.axes[index] : 0;
  if (button(12) || axis(1) <= -0.6) {keys.add("ArrowUp");}
  if (button(13) || axis(1) >= 0.6) {keys.add("ArrowDown");}
  if (button(14) || axis(0) <= -0.6) {keys.add("ArrowLeft");}
  if (button(15) || axis(0) >= 0.6) {keys.add("ArrowRight");}
  if (button(0)) {keys.add("Enter");}
  if (button(1)) {keys.add("Escape");}
  return keys;
}

export function installSamGamepad(runtimeWindow: Window, gameWindow: Window, canvas: HTMLCanvasElement) {
  let held = new Set<Key>(), paused = false, stopped = false, frame = 0;
  const dispatch = (code: Key, type: "keydown" | "keyup") => {
    const [key, keyCode] = keyDetails[code];
    const realm = gameWindow as Window & {KeyboardEvent: typeof KeyboardEvent};
    canvas.dispatchEvent(new realm.KeyboardEvent(type, {bubbles: true, cancelable: true, key, code, keyCode}));
  };
  const change = (next: Set<Key>) => {
    for (const key of held) {if (!next.has(key)) {dispatch(key, "keyup");}}
    for (const key of next) {if (!held.has(key)) {dispatch(key, "keydown");}}
    held = next;
  };
  const poll = () => {
    if (stopped) {return;}
    let pad: Gamepad | null | undefined;
    try {pad = [...runtimeWindow.navigator.getGamepads?.() ?? []].find(value => value?.connected && value.mapping === "standard");}
    catch { /* The browser may deny Gamepad access. */ }
    change(paused || runtimeWindow.document.hidden ? new Set() : samGamepadKeys(pad ?? null));
    frame = runtimeWindow.requestAnimationFrame(poll);
  };
  frame = runtimeWindow.requestAnimationFrame(poll);
  return {
    pause: () => {paused = true; change(new Set());},
    resume: () => {paused = false;},
    dispose: () => {if (!stopped) {stopped = true; runtimeWindow.cancelAnimationFrame(frame); change(new Set());}},
  };
}
