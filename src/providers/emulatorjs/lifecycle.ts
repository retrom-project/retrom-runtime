import type {LaunchEnvelopeV1, RuntimeCheckpointAvailabilityV1} from "../../provider/module-api.js";
import type {EjsInstance} from "./emulator-instance.js";
import type {LutroNativeSaveTracker} from "./lutro-native-save.js";

export function emulatorCheckpointAvailability(envelope: LaunchEnvelopeV1, instance: EjsInstance | null,
  runtimeCore: string, lutroSave: LutroNativeSaveTracker | null): RuntimeCheckpointAvailabilityV1 {
  if (!envelope.runtime.capabilities.checkpoint) {return {available: false, reason: "UNSUPPORTED"};}
  if (runtimeCore === "lutro") {return lutroSave?.getAvailability() ?? {available: false, reason: "NOT_READY"};}
  if (!instance?.gameManager || envelope.runtime.targetId === "dosbox-pure" && !envelope.targetOptions.dosEntryPath) {
    return {available: false, reason: "NOT_READY"};
  }
  return {available: true, reason: null};
}

export type StartBarrier = {
  promise: Promise<void>;
  reject(error: Error): void;
  resolve(): void;
};

export function needsVerboseRestore(core: string, restoring: boolean) {
  return restoring && (core === "ppsspp" || core === "supermodel");
}

export function runtimeStartTimeout(core: string, restoring: boolean) {
  return core === "supermodel" && restoring ? 120_000 : 30_000;
}

export function startWhenAvailable(runtimeWindow: Window) {
  const click = () => {
    const button = runtimeWindow.document.querySelector<HTMLElement>(".ejs_start_button");
    button?.click();
    return Boolean(button);
  };
  if (click()) {return () => undefined;}
  const Observer = runtimeWindow.document.defaultView?.MutationObserver;
  if (!Observer) {throw new Error("PLAYER_DOS_START_UNAVAILABLE");}
  let timeout = 0;
  const observer = new Observer(() => {
    if (!click()) {return;}
    observer.disconnect();
    runtimeWindow.clearTimeout(timeout);
  });
  observer.observe(runtimeWindow.document.documentElement, {childList: true, subtree: true});
  timeout = runtimeWindow.setTimeout(() => {
    observer.disconnect();
    runtimeWindow.dispatchEvent(new ErrorEvent("error", {error: new Error("PLAYER_DOS_START_UNAVAILABLE")}));
  }, 30_000);
  return () => {observer.disconnect(); runtimeWindow.clearTimeout(timeout);};
}

export function createStartBarrier(): StartBarrier {
  let rejectPromise: (error: Error) => void = () => undefined;
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return {promise, reject: rejectPromise, resolve: resolvePromise};
}
