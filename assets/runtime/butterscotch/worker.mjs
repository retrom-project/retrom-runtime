const maximumBytes = 16 * 1024 * 1024;
const maximumFiles = 4096;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});

function invalid() {return new Error("BUTTERSCOTCH_NATIVE_SAVE_INVALID");}
function validPath(path) {
  return path.length > 0 && !/[\u0000-\u001f\u007f\\:]/u.test(path) &&
    path.split("/").every(part => part !== "" && part !== "." && part !== "..") &&
    path.split("/").length <= 32 && encoder.encode(path).length <= 1024;
}

// BSGS, version 1, file count; each record is path length, data length, UTF-8 path,
// then uncompressed file bytes. The Provider applies its one public gzip layer.
export function encodeNativeSave(files) {
  if (!files.length || files.length > maximumFiles) {throw invalid();}
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  let size = 12; const names = new Set();
  for (const [path, bytes] of entries) {
    const parts = path.split("/");
    if (!validPath(path) || !(bytes instanceof Uint8Array) || names.has(path) ||
        parts.some((_, index) => index > 0 && names.has(parts.slice(0, index).join("/")))) {throw invalid();}
    size += 8 + encoder.encode(path).length + bytes.byteLength;
    if (size > maximumBytes) {throw invalid();}
    names.add(path);
  }
  const result = new Uint8Array(size), view = new DataView(result.buffer);
  result.set([66, 83, 71, 83]); view.setUint32(4, 1, true); view.setUint32(8, entries.length, true);
  let offset = 12;
  for (const [path, bytes] of entries) {
    const name = encoder.encode(path);
    view.setUint32(offset, name.length, true); view.setUint32(offset + 4, bytes.length, true); offset += 8;
    result.set(name, offset); offset += name.length; result.set(bytes, offset); offset += bytes.length;
  }
  return result;
}

export function decodeNativeSave(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 21 || bytes.length > maximumBytes) {throw invalid();}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x53475342 || view.getUint32(4, true) !== 1) {throw invalid();}
  const count = view.getUint32(8, true);
  if (count < 1 || count > maximumFiles) {throw invalid();}
  const files = []; let offset = 12;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > bytes.length) {throw invalid();}
    const pathSize = view.getUint32(offset, true), dataSize = view.getUint32(offset + 4, true); offset += 8;
    if (pathSize < 1 || pathSize > 1024 || offset + pathSize + dataSize > bytes.length) {throw invalid();}
    let path;
    try {path = decoder.decode(bytes.subarray(offset, offset + pathSize));} catch {throw invalid();}
    if (!validPath(path)) {throw invalid();}
    offset += pathSize;
    files.push([path, bytes.slice(offset, offset + dataSize)]); offset += dataSize;
  }
  if (offset !== bytes.length) {throw invalid();}
  // Validate uniqueness and file/directory conflicts before writing any file.
  encodeNativeSave(files);
  return files;
}

export function readNativeSave(fs, root) {
  const files = []; let size = 12, entries = 0;
  function visit(directory, depth) {
    if (depth > 32) {throw invalid();}
    for (const name of fs.readdir(directory).filter(name => name !== "." && name !== "..").sort()) {
      if (++entries > maximumFiles || !validPath(name) || name.includes("/")) {throw invalid();}
      const absolute = directory + "/" + name, stat = fs.lstat(absolute);
      const kind = stat.mode & 0o170000;
      if (kind === 0o040000) {visit(absolute, depth + 1); continue;}
      if (kind !== 0o100000 || !Number.isSafeInteger(stat.size) || stat.size < 0) {throw invalid();}
      const path = absolute.slice(root.length + 1);
      size += 8 + encoder.encode(path).length + stat.size;
      if (size > maximumBytes) {throw invalid();}
      const bytes = fs.readFile(absolute);
      if (bytes.byteLength !== stat.size) {throw invalid();}
      files.push([path, bytes]);
    }
  }
  visit(root, 0);
  return files.length ? encodeNativeSave(files) : null;
}

export function importNativeSave(fs, root, bytes) {
  const files = bytes === null ? [] : decodeNativeSave(bytes);
  fs.mkdirTree(root);
  if (fs.readdir(root).some(name => name !== "." && name !== "..")) {throw invalid();}
  for (const [path, data] of files) {
    const parent = path.lastIndexOf("/");
    if (parent >= 0) {fs.mkdirTree(root + "/" + path.slice(0, parent));}
    fs.writeFile(root + "/" + path, data);
  }
}


let runtime = null;
let paused = false;
let availabilityTimer = null;
let audioTimer = null;
let runtimeCanvas = null;
let savePath = null;
let active = false;
let queue = Promise.resolve();
function enqueue(operation) {queue = queue.then(operation).catch(() => undefined);}
async function revision(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
const audioFramesPerPull = 2048;
// Four browser slots, each containing connected + 17 buttons + 4 axes.
const gamepadStride = 22;
const gamepadFrame = new Float32Array(4 * gamepadStride);
let gamepadPointer = 0;

self.addEventListener("message", ({ data }) => {
  if (data?.type === "START") {void start(data); return;}
  if (!runtime) {return;}
  if (data?.type === "KEY") {setKey(data.keyCode, data.pressed); return;}
  if (data?.type === "GAMEPAD") {setGamepads(data.gamepads); return;}
  if (data?.type === "HOST_COMMAND") {enqueue(() => command(data));}
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
      onRunnerExit: () => {enqueue(coreExit);},
      locateFile: (path) => path.endsWith(".wasm") ? data.wasmUrl : new URL(path, data.moduleUrl).href,
    });
    stage = "CANVAS";
    registerCanvas(runtime, data.canvas);
    stage = "PROJECT_STORE";
    if (data.persistentSaves && runtime._mountOpfs() !== 0) {throw new Error("BUTTERSCOTCH_PROJECT_STORE_FAILED");}
    stage = "CONTENT_ABI";
    if (!runtime._getContentReadSlot || !runtime._registerContentFile) {throw new Error("content ABI required");}
    const offset = runtime._getContentReadSlot();
    postMessage({type: "CONTENT_READY", buffer: runtime.HEAPU8.buffer, offset});
    for (const file of data.files) {
      if (runtime.ccall("registerContentFile", "number", ["string", "number", "number"], [file.path, file.id, file.sizeBytes]) !== 0) {
        throw new Error("content registration failed");
      }
    }
    stage = "AUDIO";
    runtime._setAudioSampleRate(data.audioSampleRate);
    stage = "GAMEPAD_ABI";
    if (typeof runtime._setGamepads !== "function") {throw new Error("gamepad snapshot ABI required");}
    stage = "NATIVE_SAVE";
    if (!runtime.FS || typeof runtime._flushRunnerSaves !== "function") {throw new Error("native save ABI required");}
    savePath = data.savePath;
    importNativeSave(runtime.FS, savePath, data.restoreBytes);
    setGamepads(data.gamepads ?? []);
    stage = "RUNNER";
    runtime.ccall("startRunner", null, ["string", "string"], [data.gamePath, data.savePath]);
    active = true;
    availabilityTimer = setInterval(() => enqueue(reportAvailability), 1000);
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
    case "STATUS": {
      respond(data, await saveStatus());
      return;
    }
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
    case "STOP":
      clearInterval(availabilityTimer);
      clearInterval(audioTimer);
      availabilityTimer = null;
      audioTimer = null;
      active = false;
      runtime._stopRunner();
      if (gamepadPointer) {runtime._free(gamepadPointer); gamepadPointer = 0;}
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

function captureNativeFiles() {
  const resume = active && !paused;
  if (resume) {runtime._setRunnerPaused(1); paused = true;}
  try {
    if (active && runtime._flushRunnerSaves() !== 0) {throw new Error("native flush");}
    return readNativeSave(runtime.FS, savePath);
  } finally {
    if (resume) {runtime._setRunnerPaused(0); paused = false;}
  }
}

async function saveStatus() {
  try {
    const bytes = captureNativeFiles();
    return bytes ? {available: true, revision: await revision(bytes), status: "READY"}
      : {available: false, status: "NO_SAVE"};
  } catch {return {available: false, status: "FAILED"};}
}

async function createCheckpoint(data) {
  const bytes = captureNativeFiles();
  if (!bytes) {respond(data, {code: "BUTTERSCOTCH_NATIVE_SAVE_UNAVAILABLE", ok: false}); return;}
  const signature = await revision(bytes);
  postMessage({bytes, revision: signature, command: data.command, ok: true, requestId: data.requestId, type: "HOST_RESPONSE"},
    [bytes.buffer]);
}

async function coreExit() {
  const wasActive = active;
  active = false;
  clearInterval(availabilityTimer); clearInterval(audioTimer);
  if (!wasActive) {return;}
  try {
    const bytes = captureNativeFiles();
    const signature = bytes ? await revision(bytes) : undefined;
    postMessage({type: "runnerExit", bytes, revision: signature}, bytes ? [bytes.buffer] : []);
  } catch {
    postMessage({type: "runnerExit"});
  }
}

function setKey(keyCode, pressed) {
  const count = runtime._getKeyCount();
  if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode >= count) {return;}
  const pointer = pressed ? runtime._getKeyDownPtr() : runtime._getKeyUpPtr();
  runtime.HEAPU8[pointer + keyCode] = 1;
}

function setGamepads(gamepads) {
  gamepadFrame.fill(0);
  for (let device = 0; device < 4; device += 1) {
    const gamepad = gamepads[device];
    if (!gamepad) {continue;}
    const offset = device * gamepadStride;
    gamepadFrame[offset] = 1;
    for (let button = 0; button < 17; button += 1) {
      gamepadFrame[offset + 1 + button] = gamepad.buttons[button] ?? 0;
    }
    for (let axis = 0; axis < 4; axis += 1) {
      gamepadFrame[offset + 18 + axis] = gamepad.axes[axis] ?? 0;
    }
  }
  gamepadPointer ||= runtime._malloc(gamepadFrame.byteLength);
  runtime.HEAPF32.set(gamepadFrame, gamepadPointer / 4);
  // Publish once: the runner thread must never see only half of this frame.
  runtime._setGamepads(gamepadPointer, 4);
}

async function reportAvailability() {
  if (runtime && active) {postMessage({...await saveStatus(), type: "checkpointAvailability"});}
}

function respond(request, fields = {}) {
  postMessage({ command: request.command, ok: true, requestId: request.requestId, type: "HOST_RESPONSE", ...fields });
}
