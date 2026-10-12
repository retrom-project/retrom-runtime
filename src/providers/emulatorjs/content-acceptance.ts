import {RuntimeFailureError} from "../../provider/failure.js";
import {installEmulatorJsNativeDiagnostics} from "./native-diagnostics.js";

export function installEmulatorJsNativeObservation(realm: Window, observeContent: boolean) {
  const native = installEmulatorJsNativeDiagnostics(realm);
  const receipt = observeContent ? installContentAcceptance(realm, native) : null;
  return {
    wait: (signal: AbortSignal) => receipt?.wait(signal),
    monitor: (signal: AbortSignal, onFailure: (error: Error) => void) => receipt?.monitor(signal, onFailure),
    messages: native.messages,
    cleanup() {receipt?.cleanup(); native.cleanup();},
  };
}

/** CORE_RESULT_V1 is owned by the core. For hardware loaders its acceptance
 * occurs after graphics initialization, never merely after retro_load_game. */
export function installContentAcceptance(realm: Window, native: ReturnType<typeof installEmulatorJsNativeDiagnostics>) {
  const target = realm;
  const pending = new Set<(error: Error) => void>();
  let active = true;
  let monitorTimer: number | undefined;
  const wait = (signal: AbortSignal): Promise<void> => {
      return new Promise((resolve, reject) => {
        let timer: number | undefined, settled = false;
        const finish = (error?: Error) => {
          if (settled) {return;} settled = true;
          if (timer !== undefined) {target.clearTimeout(timer);}
          pending.delete(finish); signal.removeEventListener("abort", abort);
          if (error) {reject(error);} else {resolve();}
        };
        const abort = () => finish(new Error("PLAYER_SESSION_ENDED"));
        const poll = () => {
          if (!active || signal.aborted) {abort(); return;}
          const module = native.module, read = module?._retrom_content_load_result;
          if (!read) {finish(new RuntimeFailureError("PLAYER_CONTENT_RECEIPT_UNAVAILABLE", "CONFIGURATION")); return;}
          let value: number;
          try {value = read.call(module);} catch (error) {
            finish(new RuntimeFailureError("PLAYER_CONTENT_RECEIPT_UNAVAILABLE", "CORE", native.messages(), {cause: error})); return;
          }
          if (value === 1) {finish(); return;}
          if (value === -1 || value === -2) {
            finish(new RuntimeFailureError(value === -2 ? "PLAYER_CONTENT_ENCRYPTED" : "PLAYER_CONTENT_REJECTED", "CONTENT", native.messages())); return;
          }
          if (value !== 0) {finish(new RuntimeFailureError("PLAYER_CONTENT_RECEIPT_INVALID", "CONFIGURATION")); return;}
          timer = target.setTimeout(poll, 20);
        };
        pending.add(finish); signal.addEventListener("abort", abort, {once: true}); poll();
      });
    };
  return {
    wait,
    monitor(signal: AbortSignal, onFailure: (error: Error) => void) {
      const poll = () => {
        if (!active || signal.aborted) {return;}
        void wait(signal).then(() => {
          if (active && !signal.aborted) {monitorTimer = target.setTimeout(poll, 250);}
        }, error => {if (active && !signal.aborted) {onFailure(error);}});
      };
      poll();
    },
    cleanup() {
      active = false; target.clearTimeout(monitorTimer);
      for (const finish of pending) {finish(new Error("PLAYER_SESSION_ENDED"));}
    },
  };
}
