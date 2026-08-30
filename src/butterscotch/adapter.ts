import type { MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter } from "../internal-adapter.js";
import type { CheckpointAvailability } from "../contract.js";
import type { ButterscotchRuntimeConfig } from "./contract.js";
import { prepareButterscotchProject } from "./project-store.js";
import { createButterscotchAudio } from "./audio.js";

type HostMessage = {
  available?: boolean;
  bytes?: Uint8Array;
  code?: string;
  ok?: boolean;
  requestId?: string;
  status?: number;
  type?: string;
  samples?: Float32Array;
};
type HostCommand = "CHECKPOINT" | "PAUSE" | "RESTORE" | "RESUME" | "SCREENSHOT" | "STATUS" | "STOP";
type WorkerWindow = Window & { SharedArrayBuffer?: typeof SharedArrayBuffer; Worker: typeof Worker };

const checkpointFormat = "butterscotch-checkpoint-v2";
const commandTimeoutMs = 30_000;
const keyCodes = new Map([
  ["ArrowLeft", 37], ["ArrowUp", 38], ["ArrowRight", 39], ["ArrowDown", 40],
  ["Enter", 13], ["Escape", 27], ["Space", 32], ["KeyA", 65], ["KeyB", 66],
  ["KeyC", 67], ["KeyD", 68], ["KeyS", 83], ["KeyX", 88], ["KeyZ", 90],
]);

export async function mountButterscotch(
  config: ButterscotchRuntimeConfig,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportProgress: RuntimeProgressReporter = () => undefined,
  reportExitRequested: RuntimeExitReporter = () => undefined,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || !browserSupported(frameWindow)) {
    throw new Error("BUTTERSCOTCH_RUNTIME_UNAVAILABLE");
  }
  const project = await prepareButterscotchProject(config, frameWindow, reportProgress);
  const surface = frameWindow.document.createElement("div");
  const canvas = frameWindow.document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Butterscotch game");
  surface.dataset.butterscotchRuntimeSurface = "";
  Object.assign(surface.style, {
    alignItems: "center", display: "flex", height: "100%", justifyContent: "center", overflow: "hidden", width: "100%",
  });
  Object.assign(canvas.style, {
    background: "#000", display: "block", maxHeight: "100%", maxWidth: "100%", outline: "none", touchAction: "none",
  });
  surface.append(canvas);
  target.replaceChildren(surface);
  const runtimeBase = new URL(normalizedBase(config.adapter.runtimeBaseUrl), frameWindow.document.baseURI);
  const workerUrl = new URL("butterscotch-worker.mjs", runtimeBase);
  const worker = new (frameWindow as WorkerWindow).Worker(workerUrl, { type: "module" });
  const audio = createButterscotchAudio(frameWindow);
  const pending = new Map<string, { reject: (error: Error) => void; resolve: (message: HostMessage) => void }>();
  const ready = deferred<void>();
  const pressedKeys = new Set<number>();
  let checkpointAvailable = false;
  let checkpointStatus = 1;
  let exited = false;
  let exitReported = false;
  let gamepadFrame = 0;
  const pollGamepadFrame = () => {
    if (exited) {return;}
    sendGamepads(frameWindow, worker);
    gamepadFrame = frameWindow.requestAnimationFrame(pollGamepadFrame);
  };

  const onMessage = (event: MessageEvent<HostMessage>) => {
    const message = event.data;
    if (message.type === "AUDIO") {if (message.samples) {audio?.enqueue(message.samples);} return;}
    if (message.type === "runnerReady") {ready.resolve(); return;}
    if (message.type === "runnerExit") {
      checkpointAvailable = false;
      exited = true;
      if (!exitReported) {exitReported = true; reportExitRequested();}
      return;
    }
    if (message.type === "checkpointAvailability") {
      checkpointAvailable = message.available === true && !exited;
      checkpointStatus = normalizedCheckpointStatus(message.status, checkpointAvailable);
      return;
    }
    if (message.type === "FATAL") {ready.reject(new Error(message.code ?? "BUTTERSCOTCH_RUNTIME_FAILED")); return;}
    if (message.type !== "HOST_RESPONSE" || !message.requestId) {return;}
    const waiter = pending.get(message.requestId);
    if (!waiter) {return;}
    pending.delete(message.requestId);
    if (message.ok === false) {waiter.reject(new Error(message.code ?? "BUTTERSCOTCH_RUNTIME_COMMAND_FAILED"));}
    else {waiter.resolve(message);}
  };
  const onError = () => {ready.reject(new Error("BUTTERSCOTCH_RUNTIME_FAILED"));};
  worker.addEventListener("message", onMessage as EventListener);
  worker.addEventListener("error", onError);
  const command = createCommandSender(worker, pending);
  const focusCanvas = () => {canvas.focus({ preventScroll: true }); void audio?.resume();};
  const onKeyDown = (event: KeyboardEvent) => {void audio?.resume(); sendKey(worker, pressedKeys, event, true);};
  const onKeyUp = (event: KeyboardEvent) => {sendKey(worker, pressedKeys, event, false);};
  canvas.addEventListener("pointerdown", focusCanvas, true);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);

  try {
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({
      canvas: offscreen,
      audioEnabled: audio !== null,
      audioSampleRate: audio?.sampleRate ?? 48_000,
      gamePath: project.gamePath,
      moduleUrl: new URL("butterscotch.mjs", runtimeBase).href,
      restore: restorePayload !== null,
      savePath: project.savePath,
      type: "START",
      wasmUrl: new URL("butterscotch.wasm", runtimeBase).href,
    }, [offscreen]);
    await withTimeout(ready.promise, commandTimeoutMs, "BUTTERSCOTCH_RUNTIME_TIMEOUT");
    if (restorePayload) {
      const restore = restorePayload.slice();
      await command("RESTORE", { bytes: restore }, [restore.buffer]);
      await command("RESUME");
    }
    const status = await command("STATUS");
    checkpointAvailable = status.available === true;
    checkpointStatus = normalizedCheckpointStatus(status.status, checkpointAvailable);
    gamepadFrame = frameWindow.requestAnimationFrame(pollGamepadFrame);
    focusCanvas();
  } catch (error) {
    cleanup();
    throw stableMountError(error);
  }

  function cleanup() {
    frameWindow.cancelAnimationFrame(gamepadFrame);
    for (const keyCode of pressedKeys) {worker.postMessage({ keyCode, pressed: false, type: "KEY" });}
    pressedKeys.clear();
    worker.postMessage({ gamepads: [], type: "GAMEPAD" });
    worker.removeEventListener("message", onMessage as EventListener);
    worker.removeEventListener("error", onError);
    worker.terminate();
    void audio?.close();
    for (const waiter of pending.values()) {waiter.reject(new DOMException("Aborted", "AbortError") as unknown as Error);}
    pending.clear();
    canvas.removeEventListener("pointerdown", focusCanvas, true);
    canvas.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("keyup", onKeyUp);
    target.replaceChildren();
  }

  return {
    checkpoint: async () => {
      if (exited) {throw new Error("BUTTERSCOTCH_RUNTIME_INVALID_STATE");}
      const response = await command("CHECKPOINT");
      const bytes = copyBytes(response.bytes);
      if (!bytes || bytes.byteLength <= 12 || bytes.byteLength > 16 * 1024 * 1024) {
        throw new Error("BUTTERSCOTCH_CHECKPOINT_CREATE_FAILED");
      }
      checkpointAvailable = true;
      return { bytes, format: checkpointFormat };
    },
    exit: async () => {
      if (target.childElementCount === 0) {return;}
      checkpointAvailable = false;
      if (!exited) {await command("STOP").catch(() => undefined);}
      exited = true;
      cleanup();
    },
    getCanvas: () => canvas,
    getCheckpointAvailability: (): CheckpointAvailability => exited
      ? { available: false, blocker: "NOT_READY" }
      : checkpointAvailability(checkpointAvailable, checkpointStatus),
    getFrameCount: () => null,
    getValidationProbe: () => null,
    pause: async () => {if (exited) {throw new Error("BUTTERSCOTCH_RUNTIME_INVALID_STATE");} await command("PAUSE"); await audio?.pause();},
    resume: async () => {if (exited) {throw new Error("BUTTERSCOTCH_RUNTIME_INVALID_STATE");} await command("RESUME"); await audio?.resume();},
    screenshot: async () => {
      if (exited) {throw new Error("BUTTERSCOTCH_RUNTIME_INVALID_STATE");}
      const bytes = copyBytes((await command("SCREENSHOT")).bytes);
      if (!bytes?.byteLength) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return new Blob([bytes], {type: "image/png"});
    },
    setVolume: audio ? (volume) => audio.setVolume(volume) : null,
  };
}

function createCommandSender(
  worker: Worker,
  pending: Map<string, { reject: (error: Error) => void; resolve: (message: HostMessage) => void }>,
) {
  return (command: HostCommand, fields: Record<string, unknown> = {}, transfer: Transferable[] = []) => {
    const requestId = crypto.randomUUID();
    const response = new Promise<HostMessage>((resolve, reject) => {pending.set(requestId, { reject, resolve });});
    worker.postMessage({ command, requestId, type: "HOST_COMMAND", ...fields }, transfer);
    return withTimeout(response, commandTimeoutMs, "BUTTERSCOTCH_RUNTIME_TIMEOUT").finally(() => pending.delete(requestId));
  };
}

function sendKey(worker: Worker, pressedKeys: Set<number>, event: KeyboardEvent, pressed: boolean) {
  const keyCode = keyCodes.get(event.code);
  if (keyCode === undefined || pressed && event.repeat) {return;}
  event.preventDefault();
  if (pressed) {pressedKeys.add(keyCode);} else {pressedKeys.delete(keyCode);}
  worker.postMessage({ keyCode, pressed, type: "KEY" });
}

function sendGamepads(frameWindow: Window, worker: Worker) {
  const gamepads = typeof frameWindow.navigator.getGamepads === "function"
    ? [...frameWindow.navigator.getGamepads()].filter((value): value is Gamepad => Boolean(value?.connected && value.mapping === "standard"))
      .slice(0, 4).map((gamepad) => ({
        axes: [...gamepad.axes].slice(0, 4),
        buttons: [...gamepad.buttons].slice(0, 16).map((button) => button.value),
      }))
    : [];
  worker.postMessage({ gamepads, type: "GAMEPAD" });
}

function browserSupported(frameWindow: Window) {
  return frameWindow.crossOriginIsolated && typeof (frameWindow as WorkerWindow).Worker === "function" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function" &&
    typeof frameWindow.navigator.storage?.getDirectory === "function" &&
    typeof (frameWindow as WorkerWindow).SharedArrayBuffer !== "undefined";
}

function stableMountError(error: unknown) {
  if (error instanceof Error && /^BUTTERSCOTCH_[A-Z0-9_]+$/u.test(error.message)) {return error;}
  return new Error("BUTTERSCOTCH_RUNTIME_FAILED");
}
function checkpointAvailability(available: boolean, status: number): CheckpointAvailability {
  if (available) {return { available: true, blocker: null };}
  return { available: false, blocker: status >= 5 && status <= 7 ? "UNSUPPORTED" : "BUSY" };
}
function normalizedCheckpointStatus(value: unknown, available: boolean) {
  if (available) {return 0;}
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 7 ? Number(value) : 1;
}
function copyBytes(value: unknown) {
  if (!ArrayBuffer.isView(value)) {return null;}
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}
function normalizedBase(value: string) {return value.endsWith("/") ? value : `${value}/`;}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline;});
  return { promise, reject, resolve };
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(code)), timeoutMs);
    promise.then((value) => {window.clearTimeout(timer); resolve(value);},
      (error) => {window.clearTimeout(timer); reject(error);});
  });
}
