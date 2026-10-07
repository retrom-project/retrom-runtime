import type {EjsInstance} from "./emulator-instance.js";

const menuControls: Readonly<Record<string, number>> = {
  ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, Enter: 3, Escape: 2,
  w: 4, s: 5, a: 6, d: 7, j: 0, k: 8, "1": 3, "5": 2,
};

/** The native DOS program selector polls joypad states while direct keyboard mode bypasses EJS keyChange. */
export function installDOSMenuInput(runtimeWindow: Window, instance: EjsInstance) {
  const held = new Map<string, number>();
  const send = (control: number, value: number) => instance.gameManager?.simulateInput?.(0, control, value);
  const release = () => {
    for (const control of new Set(held.values())) {send(control, 0);}
    held.clear();
  };
  const releaseKey = (event: KeyboardEvent) => {
    const control = held.get(event.code || event.key);
    if (control === undefined) {return;}
    held.delete(event.code || event.key);
    if (![...held.values()].includes(control)) {send(control, 0);}
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const pressKey = (event: KeyboardEvent) => {
    if (instance.paused || !menuTarget(event, instance.canvas)) {return;}
    if (instance.gameManager?.Module?._retrom_dos_state_ready?.() !== 0) {return;}
    const button = menuControls[event.key];
    if (button === undefined || !instance.gameManager?.simulateInput) {return;}
    if (!event.repeat && !held.has(event.code || event.key)) {
      const alreadyDown = [...held.values()].includes(button);
      held.set(event.code || event.key, button);
      if (!alreadyDown) {send(button, 1);}
    }
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const key = (event: KeyboardEvent) => {
    if (event.type === "keyup") {releaseKey(event);} else {pressKey(event);}
  };
  runtimeWindow.document.addEventListener("keydown", key, true);
  runtimeWindow.document.addEventListener("keyup", key, true);
  runtimeWindow.addEventListener("blur", release);
  return () => {
    runtimeWindow.document.removeEventListener("keydown", key, true);
    runtimeWindow.document.removeEventListener("keyup", key, true);
    runtimeWindow.removeEventListener("blur", release);
    release();
  };
}

function menuTarget(event: KeyboardEvent, canvas: HTMLCanvasElement | undefined) {
  const target = event.target as Element | null;
  return !!canvas && !!target && typeof target.contains === "function" && target.contains(canvas);
}
