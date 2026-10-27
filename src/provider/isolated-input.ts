import {RuntimeHostShortcuts} from "./host-shortcuts.js";
import type {RuntimeHostShortcutPolicyV1, RuntimeHostShortcutV1, RuntimeInputFilterPolicyV1} from "./module-api.js";
import {installRuntimeGamepadFilter, RuntimeGamepadFilter, validInputFilterPolicy} from "./gamepad-filter.js";
import {installTouchGamepad, type TouchGamepad} from "./touch-gamepad.js";
import {installGamepadCursor, type GamepadCursor} from "./gamepad-cursor.js";
import type {TouchGamepadLayoutOptions} from "./touch-gamepad-layout.js";

/** Runs inside the isolated game realm; the parent sends policy, never cross-origin DOM access. */
export function createIsolatedInputFilter(runtimeWindow: Window) {
  let reportShortcut: (shortcut: RuntimeHostShortcutV1) => void = () => undefined;
  const shortcuts = new RuntimeHostShortcuts(["MENU", "PAUSE"], shortcut => reportShortcut(shortcut), () => true);
  shortcuts.bind(runtimeWindow);
  const filter = new RuntimeGamepadFilter(null);
  let cleanup: (() => void) | null = null;
  let touch: TouchGamepad | null = null;
  let cursor: GamepadCursor | null = null;
  let inputPolicy: RuntimeInputFilterPolicyV1 | null = null;
  let paused = false, suppressed = false;
  const refreshTouch = () => {
    touch?.setSuspended(paused || suppressed);
    cursor?.setSuspended(paused || suppressed || !touch?.getState().enabled);
  };
  return {
    onHostShortcut(report: (shortcut: RuntimeHostShortcutV1) => void) {reportShortcut = report;},
    setHostShortcutPolicy(policy: RuntimeHostShortcutPolicyV1 | null) {shortcuts.setPolicy(policy);},
    async setTouchGamepadEnabled(enabled: boolean, options: TouchGamepadLayoutOptions & {
      pointerTarget?: HTMLElement; activationEvent?: "click" | "tap";
    } = {}) {
      if (typeof enabled !== "boolean") {throw new Error("PLAYER_RUNTIME_CONTRACT_INVALID");}
      cleanup ??= installRuntimeGamepadFilter(runtimeWindow, filter);
      if (touch) {await touch.setEnabled(enabled);}
      else {
        const {pointerTarget, activationEvent, ...layout} = options;
        touch = installTouchGamepad(runtimeWindow, {...layout, enabled});
        if (pointerTarget) {
          cursor = installGamepadCursor(runtimeWindow, pointerTarget, {defaultEnabled: true, hitTest: true, activationEvent,
            readGamepads: () => {const pad = touch?.current(); return pad ? [pad as Gamepad] : [];}});
          cursor.setInputPolicy(inputPolicy);
        } else {filter.setTouchGamepad(touch);}
      }
      refreshTouch();
    },
    setPaused(value: boolean) {paused = value; refreshTouch();},
    set(policy: RuntimeInputFilterPolicyV1 | null) {
      if (policy !== null && (typeof policy !== "object" || Array.isArray(policy) ||
        Object.keys(policy).sort().join(",") !== "activeGamepadIndex,suppressInput") || !validInputFilterPolicy(policy)) {
        throw new Error("PLAYER_INPUT_FILTER_INVALID");
      }
      shortcuts.setSuppressed(policy?.suppressInput === true);
      inputPolicy = policy;
      suppressed = policy?.suppressInput === true; refreshTouch();
      filter.setPolicy(policy);
      cursor?.setInputPolicy(policy);
      cleanup ??= installRuntimeGamepadFilter(runtimeWindow, filter);
    },
    stop() {
      cursor?.dispose(); cursor = null;
      touch?.cleanup(); touch = null; filter.setTouchGamepad(null);
      shortcuts.stop(); cleanup?.(); cleanup = null; filter.setPolicy(null);
    },
  };
}
