import type {FantasyCore} from "./state.js";
const controls = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyZ", "KeyX", "KeyA", "KeyS", "Enter"];
const padButtons = [12, 13, 14, 15, 0, 1, 2, 3, 9];
const masks = {tic80: [1, 2, 4, 8, 16, 32, 64, 128, 0], fake08: [16, 32, 64, 128, 1, 256, 0, 0, 8]};
export function controlMask(core: FantasyCore, keys: ReadonlySet<string>, pads: readonly (Gamepad | null)[]) {
  const pad = pads.find((entry) => entry?.connected && entry.mapping === "standard");
  let result = 0;
  for (let i = 0; i < controls.length; i++) {
    const axis = i < 2 ? pad?.axes[1] : pad?.axes[0];
    const axisPressed = i < 4 && typeof axis === "number" && (i % 2 === 0 ? axis < -.5 : axis > .5);
    if (keys.has(controls[i]) || pad?.buttons[padButtons[i]]?.pressed || axisPressed) {result |= masks[core][i];}
  }
  return result;
}
export function installKeyboard(frameWindow: Window) {
  const keys = new Set<string>();
  const clear = () => keys.clear();
  const down = (event: KeyboardEvent) => {
    if (!controls.includes(event.code)) {return;}
    event.preventDefault(); keys.add(event.code);
  };
  const up = (event: KeyboardEvent) => {keys.delete(event.code);};
  frameWindow.addEventListener("keydown", down);
  frameWindow.addEventListener("keyup", up);
  frameWindow.addEventListener("blur", clear);
  frameWindow.document.addEventListener("visibilitychange", clear);
  return {keys, clear, stop: () => {
    clear();
    frameWindow.removeEventListener("keydown", down);
    frameWindow.removeEventListener("keyup", up);
    frameWindow.removeEventListener("blur", clear);
    frameWindow.document.removeEventListener("visibilitychange", clear);
  }};
}
