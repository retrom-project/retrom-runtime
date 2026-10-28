export type StandardGamepad = Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons">;

/** Translate one standard controller into the core's declared joypad bits. */
export function standardJoypadMask(pad: StandardGamepad | null, buttons: readonly number[]) {
  if (!pad || !pad.connected || pad.mapping !== "standard") {return 0;}
  let mask = 0;
  for (let i = 0; i < buttons.length; i++) {if (pad.buttons[i]?.pressed) {mask |= 1 << buttons[i];}}
  if ((pad.axes[0] ?? 0) < -.4) {mask |= 1 << 6;}
  if ((pad.axes[0] ?? 0) > .4) {mask |= 1 << 7;}
  if ((pad.axes[1] ?? 0) < -.4) {mask |= 1 << 4;}
  if ((pad.axes[1] ?? 0) > .4) {mask |= 1 << 5;}
  return mask;
}

export function keyboardJoypadMask(keys: ReadonlySet<string>, mapping: Readonly<Record<string, number>>) {
  let mask = 0;
  for (const code of keys) {const bit = mapping[code]; if (bit !== undefined) {mask |= 1 << bit;}}
  return mask;
}
