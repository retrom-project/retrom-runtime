const keyboard: Readonly<Record<string, number>> = {ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3,
  KeyZ: 4, KeyX: 5, KeyD: 6, KeyC: 7, Space: 8};
export function gamepadKeys(pads: readonly (Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons"> | null)[]) {
  const keys = new Set<number>();
  for (const pad of pads) {
    if (!pad?.connected || pad.mapping !== "standard") {continue;}
    const down = (i: number) => Boolean(pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5);
    for (const [button, key] of [[0, 4], [1, 5], [2, 6], [4, 7], [8, 8], [12, 0], [13, 1], [14, 2], [15, 3]]) {
      if (down(button)) {keys.add(key);}
    }
    if (pad.axes[0] < -0.4) {keys.add(2);} if (pad.axes[0] > 0.4) {keys.add(3);}
    if (pad.axes[1] < -0.4) {keys.add(0);} if (pad.axes[1] > 0.4) {keys.add(1);}
  }
  return keys;
}
export function installInput(win: Window, send: (key: number, value: number) => void) {
  const held = new Set<number>(); let previous = new Set<number>();
  let paused = false, focused = true, stopped = false, request = 0;
  const update = (next: Set<number>) => {
    for (const key of previous) {if (!next.has(key)) {send(key, 0);}}
    for (const key of next) {if (!previous.has(key)) {send(key, 1);}}
    previous = next;
  };
  const clear = () => {held.clear(); update(new Set());};
  const tick = () => {
    if (stopped) {return;}
    const next = paused || !focused || win.document.hidden ? new Set<number>()
      : new Set([...held, ...gamepadKeys(Array.from(win.navigator.getGamepads?.() ?? []))]);
    update(next); request = win.requestAnimationFrame(tick);
  };
  const key = (event: KeyboardEvent) => {
    const value = keyboard[event.code]; if (value === undefined) {return;}
    event.preventDefault();
    if (event.type === "keyup") {held.delete(value);} else if (!paused && focused) {held.add(value);}
  };
  const blur = () => {focused = false; clear();}; const focus = () => {focused = true;};
  win.addEventListener("keydown", key); win.addEventListener("keyup", key);
  win.addEventListener("blur", blur); win.addEventListener("focus", focus); request = win.requestAnimationFrame(tick);
  return {pause(value: boolean) {paused = value; if (value) {clear();}}, stop() {
    stopped = true; win.cancelAnimationFrame(request); clear();
    win.removeEventListener("keydown", key); win.removeEventListener("keyup", key);
    win.removeEventListener("blur", blur); win.removeEventListener("focus", focus);
  }};
}
