let runtime = null;
let paused = false;
let availabilityTimer = null;
let audioTimer = null;
let runtimeCanvas = null;
const audioFramesPerPull = 2048;

self.addEventListener("message", ({ data }) => {
  if (data?.type === "START") {void start(data); return;}
  if (!runtime) {return;}
  if (data?.type === "KEY") {setKey(data.keyCode, data.pressed); return;}
  if (data?.type === "GAMEPAD") {setGamepads(data.gamepads); return;}
  if (data?.type === "HOST_COMMAND") {void command(data);}
});

async function start(data) {
  let stage = "CANVAS";
  try {
    runtimeCanvas = data.canvas;
    runtimeCanvas.id = "canvas";
    stage = "MODULE";
    const factory = (await import(data.moduleUrl)).default;
    runtime = await factory({
      canvas: data.canvas,
      locateFile: (path) => path.endsWith(".wasm") ? data.wasmUrl : new URL(path, data.moduleUrl).href,
    });
    stage = "CANVAS";
    registerCanvas(runtime, data.canvas);
    stage = "PROJECT_STORE";
    if (runtime._mountOpfs() !== 0) {throw new Error("BUTTERSCOTCH_PROJECT_STORE_FAILED");}
    stage = "AUDIO";
    runtime._setAudioSampleRate(data.audioSampleRate);
    if (data.restore) {runtime._setRunnerPaused(1); paused = true;}
    stage = "RUNNER";
    runtime.ccall("startRunner", null, ["string", "string"], [data.gamePath, data.savePath]);
    availabilityTimer = setInterval(reportAvailability, 250);
    if (data.audioEnabled) {audioTimer = setInterval(pullAudio, audioFramesPerPull / data.audioSampleRate * 1000);}
  } catch {
    postMessage({ code: `BUTTERSCOTCH_RUNTIME_${stage}_FAILED`, type: "FATAL" });
  }
}

function registerCanvas(module, canvas) {
  const pointer = module._malloc(12);
  module.HEAP32[pointer >> 2] = canvas.width;
  module.HEAP32[(pointer + 4) >> 2] = canvas.height;
  module.HEAPU32[(pointer + 8) >> 2] = 0;
  module.GL.offscreenCanvases.canvas = { canvasSharedPtr: pointer, id: "canvas", offscreenCanvas: canvas };
}

async function command(data) {
  try {
    switch (data.command) {
    case "STATUS":
      respond(data, { available: runtime._isRunnerCheckpointAvailable() === 1 });
      return;
    case "PAUSE":
      runtime._setRunnerPaused(1);
      paused = true;
      respond(data);
      return;
    case "RESUME":
      runtime._setRunnerPaused(0);
      paused = false;
      respond(data);
      return;
    case "CHECKPOINT":
      await createCheckpoint(data);
      return;
    case "SCREENSHOT":
      await createScreenshot(data);
      return;
    case "RESTORE":
      restoreCheckpoint(data);
      return;
    case "STOP":
      clearInterval(availabilityTimer);
      clearInterval(audioTimer);
      availabilityTimer = null;
      audioTimer = null;
      runtime._stopRunner();
      respond(data);
      return;
    default:
      throw new Error("command");
    }
  } catch {
    respond(data, { code: "BUTTERSCOTCH_RUNTIME_COMMAND_FAILED", ok: false });
  }
}

async function createScreenshot(data) {
  if (!runtimeCanvas) {throw new Error("screenshot");}
  const blob = await runtimeCanvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  postMessage({ bytes, command: data.command, ok: true, requestId: data.requestId, type: "HOST_RESPONSE" },
    [bytes.buffer]);
}

function pullAudio() {
  if (!runtime || paused) {return;}
  const sampleCount = audioFramesPerPull * 2;
  const pointer = runtime._malloc(sampleCount * 4);
  try {
    runtime._pullAudioFrames(pointer, audioFramesPerPull);
    const samples = runtime.HEAPF32.slice(pointer / 4, pointer / 4 + sampleCount);
    postMessage({ samples, type: "AUDIO" }, [samples.buffer]);
  } finally {
    runtime._free(pointer);
  }
}

async function createCheckpoint(data) {
  const resume = !paused;
  if (resume) {runtime._setRunnerPaused(1); paused = true;}
  try {
    const status = runtime._getRunnerCheckpointStatus();
    if (status !== 0 || runtime._isRunnerCheckpointAvailable() !== 1) {
      respond(data, { code: "BUTTERSCOTCH_CHECKPOINT_UNAVAILABLE", ok: false, status });
      return;
    }
    const pointer = runtime._createRunnerCheckpoint();
    const size = pointer ? runtime._getRunnerCheckpointSize() : 0;
    if (!pointer || size <= 12 || size > 16 * 1024 * 1024) {
      respond(data, { code: "BUTTERSCOTCH_CHECKPOINT_CREATE_FAILED", ok: false });
      return;
    }
    const bytes = runtime.HEAPU8.slice(pointer, pointer + size);
    postMessage({ bytes, command: data.command, ok: true, requestId: data.requestId, type: "HOST_RESPONSE" },
      [bytes.buffer]);
  } finally {
    if (resume) {runtime._setRunnerPaused(0); paused = false;}
    reportAvailability();
  }
}

function restoreCheckpoint(data) {
  const bytes = data.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 12 || bytes.byteLength > 16 * 1024 * 1024) {
    respond(data, { code: "BUTTERSCOTCH_CHECKPOINT_RESTORE_FAILED", ok: false });
    return;
  }
  runtime._setRunnerPaused(1);
  paused = true;
  const pointer = runtime._malloc(bytes.byteLength);
  runtime.HEAPU8.set(bytes, pointer);
  const restored = runtime._restoreRunnerCheckpoint(pointer, bytes.byteLength) === 0;
  runtime._free(pointer);
  respond(data, restored ? {} : { code: "BUTTERSCOTCH_CHECKPOINT_RESTORE_FAILED", ok: false });
  reportAvailability();
}

function setKey(keyCode, pressed) {
  const count = runtime._getKeyCount();
  if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode >= count) {return;}
  const pointer = pressed ? runtime._getKeyDownPtr() : runtime._getKeyUpPtr();
  runtime.HEAPU8[pointer + keyCode] = 1;
}

function setGamepads(gamepads) {
  for (let device = 0; device < 4; device += 1) {
    const gamepad = gamepads[device];
    runtime._setGamepadConnected(device, gamepad ? 1 : 0);
    for (let button = 0; button < 16; button += 1) {
      runtime._setGamepadButton(device, button, gamepad?.buttons[button] ?? 0);
    }
    for (let axis = 0; axis < 4; axis += 1) {
      runtime._setGamepadAxis(device, axis, gamepad?.axes[axis] ?? 0);
    }
  }
}

function reportAvailability() {
  if (runtime) {postMessage({ available: runtime._isRunnerCheckpointAvailable() === 1, type: "checkpointAvailability" });}
}

function respond(request, fields = {}) {
  postMessage({ command: request.command, ok: true, requestId: request.requestId, type: "HOST_RESPONSE", ...fields });
}
