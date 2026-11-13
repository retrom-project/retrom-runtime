import {abortable} from "../content-io/abort.js";
import type {RuntimeInputFilterPolicyV1} from "../provider/module-api.js";

export type KirikiriDialogModule = {
  onConfirmDialogChanged(active: boolean): void;
  retromDialogGamepads(): (Gamepad | null)[];
  krkr2DisposeDialogs?(): void;
};

/** The dialog owns input even when the native startup stack has not returned. */
export function installKirikiriDialogInput(frameWindow: Window, changed: (active: boolean) => void) {
  const getGamepads = frameWindow.navigator.getGamepads?.bind(frameWindow.navigator);
  let active = false, policy: RuntimeInputFilterPolicyV1 | null = null;
  let updateDeadline = () => {};
  const block = (event: KeyboardEvent) => {
    if (!active) {event.preventDefault(); event.stopImmediatePropagation();}
  };
  const events = ["keydown", "keypress", "keyup"] as const;
  for (const type of events) {frameWindow.addEventListener(type, block, true);}
  const finishStartup = () => {for (const type of events) {frameWindow.removeEventListener(type, block, true);}};
  return {
    get active() {return active;},
    finishStartup,
    setInputFilter(value: RuntimeInputFilterPolicyV1 | null) {policy = value ? {...value} : null;},
    onConfirmDialogChanged(value: boolean) {
      if (active === value) {return;}
      active = value; updateDeadline(); changed(active);
    },
    retromDialogGamepads(): (Gamepad | null)[] {
      if (policy?.suppressInput || frameWindow.document.hidden) {return [];}
      try {
        return Array.from(getGamepads?.() ?? []).filter(pad => pad?.connected &&
          (policy?.activeGamepadIndex == null || pad.index === policy.activeGamepadIndex));
      } catch {return [];}
    },
    async waitForReady(operation: Promise<void>, signal: AbortSignal, timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let remaining = timeoutMs, startedAt: number | null = null;
      const timeout = new Promise<never>((_resolve, reject) => {
        updateDeadline = () => {
          clearTimeout(timer);
          const now = frameWindow.performance.now();
          if (startedAt !== null) {remaining -= Math.max(0, now - startedAt);}
          startedAt = active ? null : now;
          if (!active) {timer = setTimeout(() => reject(new Error("KIRIKIRI_RUNTIME_TIMEOUT")), Math.max(0, remaining));}
        };
        updateDeadline();
      });
      try {await abortable(Promise.race([operation, timeout]), signal);}
      finally {clearTimeout(timer); updateDeadline = () => {};}
    },
  };
}
