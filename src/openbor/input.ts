type Pad = Pick<Gamepad, "mapping" | "connected" | "buttons" | "axes">;
const buttonCodes = [4, 22, 7, 9, 29, 27, 0, 0, 41, 40, 0, 0, 82, 81, 80, 79];
export function gamepadKeys(pad: Pad | null): Set<number> {
  const keys = new Set<number>();
  if (!pad?.connected || pad.mapping !== "standard") {return keys;}
  buttonCodes.forEach((code, i) => {if (code && pad.buttons[i]?.pressed) {keys.add(code);}});
  if (pad.axes[0] < -0.5) {keys.add(80);}
  if (pad.axes[0] > 0.5) {keys.add(79);}
  if (pad.axes[1] < -0.5) {keys.add(82);}
  if (pad.axes[1] > 0.5) {keys.add(81);}
  return keys;
}
export function installInput(realm: Window, setKeys: (keys: number[]) => void) {
  let paused = false, stopped = false, focused = true, frame = 0;
  const release = () => setKeys([]);
  const blur = () => {focused = false; release();};
  const focus = () => {focused = true;};
  const tick = () => {
    if (stopped) {return;}
    const pad = [...realm.navigator.getGamepads?.() ?? []].find((value) => value?.connected && value.mapping === "standard") ?? null;
    setKeys(paused || !focused || realm.document.hidden ? [] : [...gamepadKeys(pad)]);
    frame = realm.requestAnimationFrame(tick);
  };
  realm.addEventListener("blur", blur);
  realm.addEventListener("focus", focus);
  frame = realm.requestAnimationFrame(tick);
  return {
    pause() {paused = true; release();}, resume() {paused = false;},
    dispose() {stopped = true; realm.cancelAnimationFrame(frame); realm.removeEventListener("blur", blur); realm.removeEventListener("focus", focus); release();},
  };
}
