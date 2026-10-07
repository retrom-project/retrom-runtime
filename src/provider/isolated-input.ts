import type {RuntimeInputFilterPolicyV1} from "./module-api.js";
import {installRuntimeGamepadFilter, RuntimeGamepadFilter, validInputFilterPolicy} from "./gamepad-filter.js";

/** Runs inside the isolated game realm; the parent sends policy, never cross-origin DOM access. */
export function createIsolatedInputFilter(runtimeWindow: Window) {
  const filter = new RuntimeGamepadFilter(null);
  let cleanup: (() => void) | null = null;
  return {
    set(policy: RuntimeInputFilterPolicyV1 | null) {
      if (policy !== null && (typeof policy !== "object" || Array.isArray(policy) ||
        Object.keys(policy).sort().join(",") !== "activeGamepadIndex,suppressInput") || !validInputFilterPolicy(policy)) {
        throw new Error("PLAYER_INPUT_FILTER_INVALID");
      }
      filter.setPolicy(policy);
      cleanup ??= installRuntimeGamepadFilter(runtimeWindow, filter);
    },
    stop() {cleanup?.(); cleanup = null; filter.setPolicy(null);},
  };
}
