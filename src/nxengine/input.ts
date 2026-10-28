import {keyboardJoypadMask, standardJoypadMask} from "../provider/joypad-mask.js";
// Browser standard gamepad -> libretro joypad; keyboard input stays independent.
export function padMask(pad: Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons"> | null) {
  return standardJoypadMask(pad, [0, 8, 9, 3, 10, 11, 10, 11, 2, 3, 14, 15, 4, 5, 6, 7]);
}
export function keyboardPadMask(keys: ReadonlySet<string>) {
  const mapping: Record<string, number> = {ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyZ: 0, KeyX: 8, Enter: 0, Escape: 2, KeyQ: 3, KeyW: 9, KeyA: 10, KeyS: 11};
  return keyboardJoypadMask(keys, mapping);
}
