type NativeStatus = {
  _runtime_get_frame_count(): number;
  _runtime_get_game_result(): number;
  _runtime_request_exit(): void;
};

export function mkxpStatus(value: unknown, gameFailure: () => Error = () => new Error("RPG_RUNTIME_GAME_FAILED")) {
  if (!value || typeof value !== "object" ||
    !("_runtime_get_frame_count" in value) || typeof value._runtime_get_frame_count !== "function" ||
    !("_runtime_get_game_result" in value) || typeof value._runtime_get_game_result !== "function" ||
    !("_runtime_request_exit" in value) || typeof value._runtime_request_exit !== "function") {
    throw new Error("RPG_RUNTIME_ARTIFACT_INVALID");
  }
  const module = value as NativeStatus;
  const assertHealthy = () => {
    const result = module._runtime_get_game_result();
    if (result === -1) {throw gameFailure();}
    if (result !== 0) {throw new Error("RPG_RUNTIME_STATE_UNAVAILABLE");}
  };
  return {
    assertHealthy,
    requestExit: () => {module._runtime_request_exit();},
    frames: () => {
      assertHealthy();
      const frames = module._runtime_get_frame_count();
      if (!Number.isSafeInteger(frames) || frames < 0) {throw new Error("RPG_RUNTIME_STATE_UNAVAILABLE");}
      return frames;
    },

  };
}

export type MkxpStatus = ReturnType<typeof mkxpStatus>;

export async function waitForMkxpExit(exited: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {reject(new Error("RPG_RUNTIME_EXIT_TIMEOUT"));}, 5_000);
    })]);
  } finally {clearTimeout(timer);}
}

/** Content I/O bounds each read and waits through outages; the deadline covers only time without pending reads. */
export async function waitForMkxpFrame(status: MkxpStatus, after = 0, reading: () => boolean = () => false) {
  let idle = 0, last = performance.now();
  while (idle < 30_000) {
    if (status.frames() > after) {return;}
    await new Promise((resolve) => setTimeout(resolve, 50));
    const now = performance.now();
    if (!reading()) {idle += now - last;}
    last = now;
  }
  throw new Error("RPG_RUNTIME_TIMEOUT");
}
