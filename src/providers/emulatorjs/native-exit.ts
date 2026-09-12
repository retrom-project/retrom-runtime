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
