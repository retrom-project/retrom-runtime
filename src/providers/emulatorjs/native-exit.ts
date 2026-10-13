import type {EjsInstance} from "./emulator-instance.js";

/** Own all exit sources, including upstream's beforeunload handler. */
export function installNativeExit(instance: EjsInstance) {
  const dispatch = instance.callEvent;
  if (!dispatch) {return;}
  let exited = false;
  instance.callEvent = function (...args) {
    if (args[0] !== "exit") {return dispatch.apply(this, args);}
    if (exited) {return 0;}
    exited = true;
    const functions = this.gameManager?.functions, restart = functions?.restart;
    try {
      // Keep upstream save flushing and teardown, but never reboot a closing
      // session. Content IO may already be aborted by page navigation.
      if (functions && restart) {functions.restart = () => undefined;}
      return dispatch.apply(this, args);
    } finally {if (functions && restart) {functions.restart = restart;}}
  };
}

export function requestNativeExit(instance: EjsInstance) {
  try {instance.callEvent?.("exit");}
  catch { /* Continue bounded host cleanup after a native exit error. */ }
}

/** Keep content readable until native teardown has consumed its existing grace period. */
export async function stopNativeInstance(runtimeWindow: Window | null, instance: EjsInstance | null,
  alreadyRequested: boolean, range: {idle(): Promise<void>} | null) {
  if (!runtimeWindow || !instance?.callEvent) {return;}
  if (!alreadyRequested) {requestNativeExit(instance);}
  let timer: number | undefined;
  try {
    await Promise.race([range?.idle() ?? Promise.resolve(), new Promise<void>(resolve => {timer = runtimeWindow.setTimeout(resolve, 1_100);})]);
  } finally {runtimeWindow.clearTimeout(timer);}
  await new Promise<void>((resolve) => runtimeWindow.setTimeout(resolve, 1_100));
}
