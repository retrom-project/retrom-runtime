type NativeStatus = {
  _runtime_get_frame_count(): number;
  _runtime_get_state_result(): number;
  _runtime_request_state(operation: number): number;
  _runtime_request_exit(): void;
};

export function mkxpStatus(value: unknown) {
  if (!value || typeof value !== "object" ||
    !("_runtime_get_frame_count" in value) || typeof value._runtime_get_frame_count !== "function" ||
    !("_runtime_get_state_result" in value) || typeof value._runtime_get_state_result !== "function" ||
    !("_runtime_request_state" in value) || typeof value._runtime_request_state !== "function" ||
    !("_runtime_request_exit" in value) || typeof value._runtime_request_exit !== "function") {
    throw new Error("RPG_RUNTIME_ARTIFACT_INVALID");
  }
  const module = value as NativeStatus;
  return {
    requestSave: () => {
      if (module._runtime_request_state(1) !== 1) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    },
    requestRestore: () => {
      if (module._runtime_request_state(2) !== 1) {throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");}
    },
    requestExit: () => {module._runtime_request_exit();},
    frames: () => {
      const frames = module._runtime_get_frame_count();
      if (!Number.isSafeInteger(frames) || frames < 0) {throw new Error("RPG_RUNTIME_STATE_UNAVAILABLE");}
      return frames;
    },
    stateResult: () => {
      const result = module._runtime_get_state_result();
      if (result !== -1 && result !== 0 && result !== 1) {throw new Error("RPG_RUNTIME_STATE_UNAVAILABLE");}
      return result;
    },
  };
}

export type MkxpStatus = ReturnType<typeof mkxpStatus>;

export async function waitForMkxpSave(status: MkxpStatus) {
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    const result = status.stateResult();
    if (result === -1) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    if (result === 1) {return;}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("RPG_CHECKPOINT_CREATE_TIMEOUT");
}

export async function waitForMkxpExit(exited: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {reject(new Error("RPG_RUNTIME_EXIT_TIMEOUT"));}, 5_000);
    })]);
  } finally {clearTimeout(timer);}
}

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
    const result = status.stateResult();
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
