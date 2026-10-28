import {keyboardJoypadMask, standardJoypadMask} from "../provider/joypad-mask.js";
// Browser standard gamepad -> libretro joypad; keyboard input stays independent.
export function padMask(pad: Gamepad | null) {
  // With the native default VbtnSwap=0, B is TRIG1 and A is TRIG2.
  return standardJoypadMask(pad, [0, 8, 9, 1, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7]);
}
export function keyboardPadMask(keys: ReadonlySet<string>) {
  const mapping: Record<string, number> = {ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyZ: 8, KeyX: 0};
  return keyboardJoypadMask(keys, mapping);
}
export function keyCode(event: Pick<KeyboardEvent, "code" | "key">) {
  const special: Record<string, number> = {Enter: 13, Escape: 27, Space: 32, Backspace: 8, Tab: 9,
    ArrowUp: 273, ArrowDown: 274, ArrowRight: 275, ArrowLeft: 276, Delete: 127,
    ShiftLeft: 304, ShiftRight: 303, ControlLeft: 306, ControlRight: 305};
  if (special[event.code]) {return special[event.code];}
  if (/^F(?:[1-9]|1[0-2])$/u.test(event.code)) {return 281 + Number(event.code.slice(1));}
  return event.key.length === 1 && event.key.charCodeAt(0) < 128 ? event.key.toLowerCase().charCodeAt(0) : null;
}
