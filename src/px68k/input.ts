// Browser standard gamepad -> libretro joypad; keyboard input stays independent.
export function padMask(pad: Gamepad | null) {
  if (!pad || !pad.connected || pad.mapping !== "standard") {return 0;}
  const mapping = [8, 0, 9, 1, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7];
  let mask = 0;
  for (let i = 0; i < mapping.length; i++) {if (pad.buttons[i]?.pressed) {mask |= 1 << mapping[i];}}
  if ((pad.axes[0] ?? 0) < -.4) {mask |= 1 << 6;}
  if ((pad.axes[0] ?? 0) > .4) {mask |= 1 << 7;}
  if ((pad.axes[1] ?? 0) < -.4) {mask |= 1 << 4;}
  if ((pad.axes[1] ?? 0) > .4) {mask |= 1 << 5;}
  return mask;
}
export function keyboardPadMask(keys: ReadonlySet<string>) {
  const mapping: Record<string, number> = {ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyZ: 8, KeyX: 0};
  let mask = 0;
  for (const code of keys) {const bit = mapping[code]; if (bit !== undefined) {mask |= 1 << bit;}}
  return mask;
}
export function keyCode(event: Pick<KeyboardEvent, "code" | "key">) {
  const special: Record<string, number> = {Enter: 13, Escape: 27, Space: 32, Backspace: 8, Tab: 9,
    ArrowUp: 273, ArrowDown: 274, ArrowRight: 275, ArrowLeft: 276, Delete: 127,
    ShiftLeft: 304, ShiftRight: 303, ControlLeft: 306, ControlRight: 305};
  if (special[event.code]) {return special[event.code];}
  if (/^F(?:[1-9]|1[0-2])$/u.test(event.code)) {return 281 + Number(event.code.slice(1));}
  return event.key.length === 1 && event.key.charCodeAt(0) < 128 ? event.key.toLowerCase().charCodeAt(0) : null;
}
