import {restorePspCheckpoint} from "./psp-state.js";
import type {EjsInstance} from "./emulator-instance.js";

export async function restoreEmulatorCheckpoint(manager: EjsInstance["gameManager"], core: string,
  bytes: Uint8Array, maximum: number, waitPsp: Parameters<typeof restorePspCheckpoint>[3], signal: AbortSignal): Promise<void> {
  if (core === "ppsspp") {await restorePspCheckpoint(manager, bytes, maximum, waitPsp, signal);}
  else if (manager?.loadExplicitStateAndWait) {await manager.loadExplicitStateAndWait(bytes);}
  else if (manager?.loadStateAndWait) {await manager.loadStateAndWait(bytes);}
  else if (manager?.loadState) {manager.loadState(bytes);}
  else {throw new Error("PLAYER_STATE_RESTORE_FAILED");}
}
