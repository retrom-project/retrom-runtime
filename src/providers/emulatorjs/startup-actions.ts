import type {EmulatorImplementation} from "./catalog.js";
import type {EjsInstance} from "./emulator-instance.js";

export function scheduleStartupActions(runtimeWindow: Window, implementation: EmulatorImplementation, instance: EjsInstance | null, timers: Set<number>) {
  if (!implementation.startupActions.length) {return;}
  const manager = instance?.gameManager;
  const simulate = manager?.simulateInput?.bind(manager);
  if (!simulate) {throw new Error("PLAYER_STARTUP_ACTION_UNAVAILABLE");}
  for (const action of implementation.startupActions) {
    const pressTimer = runtimeWindow.setTimeout(() => {
      timers.delete(pressTimer);
      simulate(action.player, action.control, 1);
      const releaseTimer = runtimeWindow.setTimeout(() => {
        timers.delete(releaseTimer);
        simulate(action.player, action.control, 0);
      }, action.durationMs);
      timers.add(releaseTimer);
    }, action.delayMs);
    timers.add(pressTimer);
  }
}

