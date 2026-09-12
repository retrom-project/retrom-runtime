// Browser standard gamepad -> libretro joypad; keyboard input stays independent.
export function padMask(pad: Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons"> | null) {
  if (!pad || !pad.connected || pad.mapping !== "standard") {return 0;}
  const mapping = [0, 8, 9, 3, 10, 11, 10, 11, 2, 3, 14, 15, 4, 5, 6, 7];
  let mask = 0;
  for (let i = 0; i < mapping.length; i++) {if (pad.buttons[i]?.pressed) {mask |= 1 << mapping[i];}}
  if ((pad.axes[0] ?? 0) < -.4) {mask |= 1 << 6;}
  if ((pad.axes[0] ?? 0) > .4) {mask |= 1 << 7;}
  if ((pad.axes[1] ?? 0) < -.4) {mask |= 1 << 4;}
  if ((pad.axes[1] ?? 0) > .4) {mask |= 1 << 5;}
  return mask;
}
export function keyboardPadMask(keys: ReadonlySet<string>) {
  const mapping: Record<string, number> = {ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyZ: 0, KeyX: 8, Enter: 0, Escape: 2, KeyQ: 3, KeyW: 9, KeyA: 10, KeyS: 11};
  let mask = 0;
  for (const code of keys) {const bit = mapping[code]; if (bit !== undefined) {mask |= 1 << bit;}}
  return mask;
}
