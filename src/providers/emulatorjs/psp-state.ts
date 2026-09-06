type NativeStateModule = {
  HEAPU8?: Uint8Array;
  UTF8ToString?: (pointer: number) => string;
  cwrap?: (name: string, type: "number", args: string[], options: {async: true}) => (...args: (string | number)[]) => Promise<number>;
  _free?: (pointer: number) => void;
};

type PspStateManager = {
  Module?: NativeStateModule;
  toggleMainLoop?: (running: boolean) => void;
  FS?: {writeFile?: (path: string, bytes: Uint8Array) => void; unlink?: (path: string) => void};
  clearEJSResetTimer?: () => void;
};

export async function restorePspCheckpoint(manager: PspStateManager | undefined, bytes: Uint8Array, maximum: number,
  registerLoad: () => {promise: Promise<void>; cancel: () => void}, signal?: AbortSignal,
) {
  const module = manager?.Module, fs = manager?.FS;
  if (!manager?.toggleMainLoop || !module?.cwrap || !fs?.writeFile || !fs.unlink) {throw unavailable();}
  await waitForPspState(manager, module, maximum, signal);
  const path = "/game.state";
  const completion = registerLoad();
  try {
    fs.writeFile(path, new Uint8Array(bytes));
    manager.clearEJSResetTimer?.();
    const load = module.cwrap("load_state", "number", ["string", "number"], {async: true});
    await Promise.all([load(path, 0).then(() => manager.toggleMainLoop!(true)), completion.promise]);
  } finally {
    completion.cancel(); manager.toggleMainLoop(false);
    try {fs.unlink(path);} catch { /* Native loading may already remove the file. */ }
  }
}

async function waitForPspState(manager: PspStateManager, module: NativeStateModule, maximum: number, signal?: AbortSignal) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {throw new Error("PLAYER_SESSION_ENDED");}
    manager.toggleMainLoop!(false);
    try {
      await readPspNativeState(module, maximum);
      if (signal?.aborted) {throw new Error("PLAYER_SESSION_ENDED");}
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "PLAYER_STATE_UNAVAILABLE") {throw error;}
    }
    manager.toggleMainLoop!(true);
    await new Promise<void>((resolve, reject) => {
      const finish = () => {signal?.removeEventListener("abort", abort); resolve();};
      const timer = setTimeout(finish, 50);
      const abort = () => {clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new Error("PLAYER_SESSION_ENDED"));};
      signal?.addEventListener("abort", abort, {once: true});
      if (signal?.aborted) {abort();}
    });
  }
  manager.toggleMainLoop!(false);
  throw new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT");
}

export async function readPspCheckpoint(
  manager: PspStateManager | undefined,
  maximum: number, paused: boolean,
) {
  if (!manager?.toggleMainLoop) {throw unavailable();}
  // Native serialization yields through Asyncify. Keep the browser main loop
  // stopped until its Promise settles; reentry during rewind corrupts the stack.
  manager.toggleMainLoop(false);
  try {return await readPspNativeState(manager.Module, maximum);}
  finally {manager.toggleMainLoop(!paused);}
}

export async function readPspNativeState(module: NativeStateModule | undefined, maximum: number) {
  if (!module?.cwrap || !module.UTF8ToString || !module._free) {throw unavailable();}
  const info = await module.cwrap("save_state_info", "number", [], {async: true})();
  const heap = module.HEAPU8;
  if (!heap || !Number.isSafeInteger(info) || info <= 0 || info >= heap.byteLength) {throw unavailable();}
  const [rawSize, rawStart, succeeded] = module.UTF8ToString(info).split("|");
  const size = Number(rawSize), start = Number(rawStart);
  if (succeeded !== "1" || !Number.isSafeInteger(size) || size <= 0 ||
    !Number.isSafeInteger(start) || start <= 0 || start + size > heap.byteLength) {throw unavailable();}
  // The native descriptor is borrowed native storage. The pinned JS helper frees
  // that descriptor and passes a typed array to free; release only the data pointer.
  try {
    if (size > maximum) {throw unavailable();}
    return heap.slice(start, start + size);
  } finally {module._free(start);}
}

function unavailable() {return new Error("PLAYER_STATE_UNAVAILABLE");}
