type InputCore = {
  _retrom_mame_key(id: number, down: number): void;
  _retrom_mame_button(id: number, down: number): void;
  _retrom_mame_axis(id: number, value: number): void;
};
const nativeButtons = [[0, 0], [1, 8]] as const;
const nativeKeys = [[2, 32], [3, 13], [8, 27], [9, 49]] as const;
export function padState(pads: readonly (Gamepad | null)[], machine: string = "apple2p", arcade = false) {
  const pad = pads.find(p => p?.connected && p.mapping === "standard");
  const pressed = (id: number) => pad?.buttons[id]?.pressed === true;
  const axis = (index: number, negative: number, positive: number) => {
    if (pressed(negative) || pressed(positive)) {return (Number(pressed(positive)) - Number(pressed(negative))) * 32767;}
    const value = pad?.axes[index] ?? 0;
    return Number.isFinite(value) && Math.abs(value) >= .2 ? Math.round(Math.max(-1, Math.min(1, value)) * 32767) : 0;
  };
  const axes = [axis(0, 14, 15), axis(1, 12, 13)];
  const direction = [axes[1] < 0, axes[1] > 0, axes[0] < 0, axes[0] > 0];
  if (machine === "atom") {
    const keys = [[0, 32], [1, 13], [8, 27], [9, 13]].filter(([id]) => pressed(id)).map(([, key]) => key);
    direction.forEach((down, index) => {if (down) {keys.push([59, 46, 122, 120][index]);}});
    return {axes: [0, 0], buttons: [], keys: [...new Set(keys)].sort((a, b) => a - b)};
  }
  if (machine === "coleco") {
    const keys = [[8, 258], [9, 257]].filter(([id]) => pressed(id)).map(([, key]) => key);
    const buttons = [[0, 0], [1, 8]].filter(([id]) => pressed(id)).map(([, button]) => button);
    direction.forEach((down, index) => {if (down) {buttons.push(4 + index);}});
    return {axes: [0, 0], keys, buttons: buttons.sort((a, b) => a - b)};
  }
  if (arcade) {
    const buttons = [[0, 0], [1, 8], [2, 1], [3, 9], [4, 10], [5, 11], [8, 2], [9, 3]]
      .filter(([id]) => pressed(id)).map(([, button]) => button);
    direction.forEach((down, index) => {if (down) {buttons.push(4 + index);}});
    return {axes: [0, 0], keys: [], buttons: buttons.sort((a, b) => a - b)};
  }
  if (machine === "pv1000" || machine === "sg1000" || !["apple2p", "apple2e", "atom"].includes(machine)) {
    const buttons = [[0, 0], [1, 8], [8, 2], [9, 3]].filter(([id]) => pressed(id)).map(([, button]) => button);
    direction.forEach((down, index) => {if (down) {buttons.push(4 + index);}});
    return {axes: [0, 0], keys: [], buttons: buttons.sort((a, b) => a - b)};
  }
  return {axes,
    buttons: nativeButtons.filter(([id]) => pressed(id)).map(([, native]) => native),
    keys: nativeKeys.filter(([id]) => pressed(id)).map(([, native]) => native)};
}
export class MameInput {
  readonly keyboard = new Set<number>();
  private keys = new Set<number>();
  private buttons = new Set<number>();
  constructor(private readonly core: InputCore, private readonly machine: string = "apple2p", private readonly arcade = false) {}
  poll(pads: readonly (Gamepad | null)[]) {
    const state = padState(pads, this.machine, this.arcade), keys = new Set([...this.keyboard, ...state.keys]), buttons = new Set(state.buttons);
    this.update(this.keys, keys, (id, value) => this.core._retrom_mame_key(id, value));
    this.update(this.buttons, buttons, (id, value) => this.core._retrom_mame_button(id, value));
    this.keys = keys; this.buttons = buttons;
    state.axes.forEach((value, id) => this.core._retrom_mame_axis(id, value));
  }
  clear() {this.keyboard.clear(); this.poll([]);}
  private update(previous: Set<number>, next: Set<number>, send: (id: number, value: number) => void) {
    for (const id of previous) {if (!next.has(id)) {send(id, 0);}}
    for (const id of next) {if (!previous.has(id)) {send(id, 1);}}
  }
}
const keys: Record<string, number> = {Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32,
  Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47, Semicolon: 59, Equal: 61,
  BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96, Delete: 127,
  ArrowUp: 273, ArrowDown: 274, ArrowRight: 275, ArrowLeft: 276, CapsLock: 301,
  ShiftRight: 303, ShiftLeft: 304, ControlRight: 305, ControlLeft: 306, AltRight: 307, AltLeft: 308};
export function keyboardKey(code: string): number | null {
  if (/^Key[A-Z]$/u.test(code)) {return code.charCodeAt(3) + 32;}
  if (/^Digit[0-9]$/u.test(code)) {return code.charCodeAt(5);}
  if (/^Numpad[0-9]$/u.test(code)) {return 256 + Number(code.charAt(6));}
  return keys[code] ?? null;
}
export function installInput(win: Window, core: InputCore, machine: string, arcade = false) {
  const input = new MameInput(core, machine, arcade);
  const down = (e: KeyboardEvent) => {const key = keyboardKey(e.code); if (key !== null) {e.preventDefault(); input.keyboard.add(key);}};
  const up = (e: KeyboardEvent) => {const key = keyboardKey(e.code); if (key !== null) {e.preventDefault(); input.keyboard.delete(key);}};
  const clear = () => input.clear();
  win.addEventListener("keydown", down); win.addEventListener("keyup", up); win.addEventListener("blur", clear);
  win.document.addEventListener("visibilitychange", clear);
  return {input, stop: () => {
    clear(); win.removeEventListener("keydown", down); win.removeEventListener("keyup", up); win.removeEventListener("blur", clear);
    win.document.removeEventListener("visibilitychange", clear);
  }};
}
