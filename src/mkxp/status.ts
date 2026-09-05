type NativeStatus = {
  _runtime_get_frame_count(): number;
  _runtime_get_restore_result(): number;
};

export function mkxpStatus(value: unknown) {
  if (!value || typeof value !== "object" ||
    !("_runtime_get_frame_count" in value) || typeof value._runtime_get_frame_count !== "function" ||
    !("_runtime_get_restore_result" in value) || typeof value._runtime_get_restore_result !== "function") {
    throw new Error("RPG_RUNTIME_ARTIFACT_INVALID");
  }
  const module = value as NativeStatus;
  return {
    frames: () => {
      const frames = module._runtime_get_frame_count();
      if (!Number.isSafeInteger(frames) || frames < 0) {throw new Error("RPG_RUNTIME_STATE_UNAVAILABLE");}
      return frames;
    },
    restoreResult: () => {
      const result = module._runtime_get_restore_result();
      if (result !== -1 && result !== 0 && result !== 1) {throw new Error("RPG_RUNTIME_STATE_UNAVAILABLE");}
      return result;
    },
  };
}

export type MkxpStatus = ReturnType<typeof mkxpStatus>;

export async function waitForMkxpFrame(status: MkxpStatus, after = 0) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (status.frames() > after) {return;}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("RPG_RUNTIME_TIMEOUT");
}

export async function waitForMkxpRestore(status: MkxpStatus) {
  const deadline = performance.now() + 30_000;
  let completedAtFrame: number | null = null;
  while (performance.now() < deadline) {
    const result = status.restoreResult();
    if (result === -1) {throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");}
    if (result === 1) {
      // A success receipt alone is insufficient: the restored core must resume
      // presenting frames. Reading a main-thread atomic never invokes worker GL.
      completedAtFrame ??= status.frames();
      if (status.frames() > completedAtFrame) {return;}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
}
