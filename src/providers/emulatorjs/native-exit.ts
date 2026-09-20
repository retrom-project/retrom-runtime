import type {EjsInstance} from "./emulator-instance.js";

export function requestNativeExit(instance: EjsInstance, core: string) {
  const functions = ["ppsspp", "neocd"].includes(core) ? instance.gameManager?.functions : undefined;
  const restart = functions?.restart;
  try {
    // Upstream resets to flush directory saves. Instant-state PSP and Range-backed NeoCD must not reboot on exit.
    if (functions && restart) {functions.restart = () => undefined;}
    instance.callEvent?.("exit");
  } catch { /* Continue bounded host cleanup after a native exit error. */ }
  finally {if (functions && restart) {functions.restart = restart;}}
}

/** Keep content readable until native teardown has consumed its existing grace period. */
export async function stopNativeInstance(runtimeWindow: Window | null, instance: EjsInstance | null,
  core: string, alreadyRequested: boolean, range: {idle(): Promise<void>} | null) {
  if (!runtimeWindow || !instance?.callEvent) {return;}
  if (!alreadyRequested) {requestNativeExit(instance, core);}
  let timer: number | undefined;
  try {
    await Promise.race([range?.idle() ?? Promise.resolve(), new Promise<void>(resolve => {timer = runtimeWindow.setTimeout(resolve, 1_100);})]);
  } finally {runtimeWindow.clearTimeout(timer);}
  await new Promise<void>((resolve) => runtimeWindow.setTimeout(resolve, 1_100));
}
