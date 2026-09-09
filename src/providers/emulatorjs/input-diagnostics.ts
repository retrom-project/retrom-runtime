import type {RuntimeInputDiagnosticsV1} from "../../provider/module-api.js";
import {inputObserver} from "../../provider/input-observations.js";
import type {EjsInstance} from "./emulator-instance.js";

export function observeEmulatorInput(window: Window, instance: EjsInstance | null, session: RuntimeInputDiagnosticsV1): RuntimeInputDiagnosticsV1 {
  const manager = instance?.gameManager;
  const original = manager?.simulateInput;
  if (!manager || !original) {return session;}
  let active = true;
  const observed: typeof original = function (this: NonNullable<EjsInstance["gameManager"]>, player, control, value) {
    const result = original.call(this, player, control, value);
    if (active) {
      try {
        inputObserver(window)?.record({device: `player:${player}`, control: `Control ${control}`, value,
          stage: "DELIVERED", target: "core-input", reason: null}, window.performance.now());
      } catch { /* Diagnostics cannot interrupt the input path. */ }
    }
    return result;
  };
  try {manager.simulateInput = observed;} catch {return session;}
  return {...session, stop: () => {
    active = false;
    try {if (manager.simulateInput === observed) {manager.simulateInput = original;}} catch { /* Preserve later ownership changes. */ }
    session.stop();
  }};
}
