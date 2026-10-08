import {RuntimeHostShortcuts} from "./host-shortcuts.js";
import type {RuntimeHostShortcutPolicyV1, RuntimeHostShortcutV1, RuntimeInputFilterPolicyV1} from "./module-api.js";
import {installRuntimeGamepadFilter, RuntimeGamepadFilter, validInputFilterPolicy} from "./gamepad-filter.js";

/** Runs inside the isolated game realm; the parent sends policy, never cross-origin DOM access. */
export function createIsolatedInputFilter(runtimeWindow: Window) {
  let reportShortcut: (shortcut: RuntimeHostShortcutV1) => void = () => undefined;
  const shortcuts = new RuntimeHostShortcuts(["MENU", "PAUSE"], shortcut => reportShortcut(shortcut), () => true);
  shortcuts.bind(runtimeWindow);
  const filter = new RuntimeGamepadFilter(null);
  let cleanup: (() => void) | null = null;
  return {
    onHostShortcut(report: (shortcut: RuntimeHostShortcutV1) => void) {reportShortcut = report;},
    setHostShortcutPolicy(policy: RuntimeHostShortcutPolicyV1 | null) {shortcuts.setPolicy(policy);},
    set(policy: RuntimeInputFilterPolicyV1 | null) {
      if (policy !== null && (typeof policy !== "object" || Array.isArray(policy) ||
        Object.keys(policy).sort().join(",") !== "activeGamepadIndex,suppressInput") || !validInputFilterPolicy(policy)) {
        throw new Error("PLAYER_INPUT_FILTER_INVALID");
      }
      shortcuts.setSuppressed(policy?.suppressInput === true);
      filter.setPolicy(policy);
      cleanup ??= installRuntimeGamepadFilter(runtimeWindow, filter);
    },
    stop() {shortcuts.stop(); cleanup?.(); cleanup = null; filter.setPolicy(null);},
  };
}
