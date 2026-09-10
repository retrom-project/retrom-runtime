export function gamepadKeys(pads: readonly (Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons"> | null)[]) {
  const keys = new Set<number>();
  for (const pad of pads) {
    if (!pad?.connected || pad.mapping !== "standard") {continue;}
    const down = (index: number) => Boolean(pad.buttons[index]?.pressed || pad.buttons[index]?.value > 0.5);
    if (down(12) || pad.axes[1] < -0.4) {keys.add(0x3a);}
    if (down(13) || pad.axes[1] > 0.4) {keys.add(0x3d);}
    if (down(14) || pad.axes[0] < -0.4) {keys.add(0x3b);}
    if (down(15) || pad.axes[0] > 0.4) {keys.add(0x3c);}
    for (const [button, key] of [[0, 0x34], [1, 0x00], [2, 0x29], [3, 0x2a], [9, 0x1c]]) {
      if (down(button)) {keys.add(key);}
    }
  }
  return keys;
}
export function updateKeys(previous: Set<number>, next: Set<number>, send: (key: number, pressed: number) => void) {
  for (const key of previous) {if (!next.has(key)) {send(key, 0);}}
  for (const key of next) {if (!previous.has(key)) {send(key, 1);}}
}
export function installGamepad(win: Window, send: (key: number, pressed: number) => void) {
  let previous = new Set<number>(), request = 0, paused = false, stopped = false, focused = true;
  const clear = () => {updateKeys(previous, new Set(), send); previous.clear();};
  const tick = () => {
    if (stopped) {return;}
    const next = paused || !focused || win.document.hidden ? new Set<number>() : gamepadKeys(Array.from(win.navigator.getGamepads?.() ?? []));
    updateKeys(previous, next, send); previous = next;
    request = win.requestAnimationFrame(tick);
  };
  const blur = () => {focused = false; clear();};
  const focus = () => {focused = true;};
  win.addEventListener("blur", blur); win.addEventListener("focus", focus); request = win.requestAnimationFrame(tick);
  return {pause(value: boolean) {paused = value; if (value) {clear();}}, stop() {
    stopped = true; win.cancelAnimationFrame(request); win.removeEventListener("blur", blur); win.removeEventListener("focus", focus); clear();
  }};
}
