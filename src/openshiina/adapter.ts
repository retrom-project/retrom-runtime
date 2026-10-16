import {sha256} from "@noble/hashes/sha2.js";
import {combineSignals} from "../content-io/abort.js";
import type {RuntimeCheckpoint} from "../contract.js";
import type {MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter} from "../internal-adapter.js";
import {installGamepadCursor} from "../provider/gamepad-cursor.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {parseProjectIndex} from "../provider/project-index.js";
import {requireContentSession, type AdapterContentOptions} from "../provider/content-inputs.js";
import {decodeSave, encodeSave, hasProgress, maximumSaveBytes, saveFormat, type SaveFiles} from "./checkpoint.js";
import {createGameFiles} from "./content.js";
import {loadCore, type CoreLoader, type CorePlayer, type ShiinaParameters} from "./core.js";

export async function mountShiina(config: ShiinaParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, progress: RuntimeProgressReporter, reportFailure: (error: Error) => void,
  reportExit: RuntimeExitReporter, content: AdapterContentOptions, loader: CoreLoader = loadCore): Promise<MountedRuntimeAdapter> {
  const current: SaveFiles = restorePayload ? decodeSave(restorePayload, config.contentDigest) : Object.create(null) as SaveFiles;
  const session = requireContentSession(content.contentSession);
  const controller = new AbortController(), scope = combineSignals([controller.signal, ...(content.signal ? [content.signal] : [])]);
  progress({phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: null});
  const base = new URL(config.projectIndexUrl, document.baseURI);
  const index = parseProjectIndex(await fetchMetadataJson(base, indexByteBudget(100000, 1024), scope.signal), 100000);
  if (!index || !index.files.some(f => /^rio\.ini$/iu.test(f.path)) || !index.files.some(f => /^[^/]+\.war$/iu.test(f.path))) {
    scope.dispose(); throw new Error("SHIINA_PROJECT_INVALID");
  }
  progress({phase: "PROJECT_INDEX", loadedBytes: 1, totalBytes: 1});
  const files = createGameFiles(index.files, config.contentDigest, session, base.href, scope.signal);
  const canvas = frameWindow.document.createElement("canvas"); canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "ShiinaRio game"); target.append(canvas);
  const Audio = (frameWindow as Window & typeof globalThis).AudioContext;
  const audio = new Audio(), gain = audio.createGain(); gain.connect(audio.destination);
  let player: CorePlayer | null = null, stopped = false, paused = false, frameCount = 0;
  let changed = 0, cachedAt = -1, cached: Uint8Array | null = null;
  let baseline = restorePayload ? signature(restorePayload) : "";
  const held = new Set<number>(); let x = 0, y = 0;
  const cursor = installGamepadCursor(frameWindow, canvas, {defaultEnabled: true});
  const release = () => {
    for (const key of held) {player?.input(0, key, 0, 0);} held.clear(); player?.input(1, x, y, 0);
  };
  const keyEvent = (event: KeyboardEvent) => {
    if (paused || stopped || !player) {return;}
    const key = virtualKey(event); if (!key) {return;}
    const down = event.type === "keydown";
    if (down && held.has(key)) {return;}
    if (down) {held.add(key);} else {held.delete(key);}
    player.input(0, key, down ? 1 : 0, 0); event.preventDefault();
  };
  const mouseEvent = (event: MouseEvent) => {
    if (paused || stopped || !player) {return;}
    const bounds = canvas.getBoundingClientRect();
    x = Math.max(0, Math.min(player.info.width - 1, Math.round((event.clientX - bounds.left) * player.info.width / Math.max(1, bounds.width))));
    y = Math.max(0, Math.min(player.info.height - 1, Math.round((event.clientY - bounds.top) * player.info.height / Math.max(1, bounds.height))));
    player.input(1, x, y, event.buttons & 7); event.preventDefault();
  };
  const wheel = (event: WheelEvent) => {if (!paused && !stopped) {player?.input(2, event.deltaY < 0 ? 120 : -120, 0, 0); event.preventDefault();}};
  const contextMenu = (event: Event) => event.preventDefault();
  const unlock = () => {if (!stopped && !paused) {canvas.focus({preventScroll: true}); void audio.resume().catch(() => {});}};
  const abort = () => {void exit();};
  const exit = async () => {
    if (stopped) {return;} stopped = true; release(); cursor.dispose();
    controller.abort(); player?.stop(); await files.close();
    for (const type of ["keydown", "keyup"]) {frameWindow.removeEventListener(type, keyEvent as EventListener);}
    for (const type of ["mousemove", "mousedown", "mouseup"]) {canvas.removeEventListener(type, mouseEvent as EventListener);}
    frameWindow.removeEventListener("blur", release); canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("contextmenu", contextMenu); canvas.removeEventListener("mousedown", unlock);
    content.signal?.removeEventListener("abort", abort); scope.dispose(); canvas.remove(); gain.disconnect(); await audio.close();
  };
  const currentBytes = () => {
    if (cachedAt !== changed) {cachedAt = changed; cached = hasProgress(current) ? encodeSave(config.contentDigest, current) : null;}
    return cached;
  };
  const availability: MountedRuntimeAdapter["getCheckpointAvailability"] = () => {
    const save = {dataKind: "PROGRESS", capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false} as const;
    if (stopped) {return {available: false, blocker: "NOT_READY", save};}
    try {
      const bytes = currentBytes(); if (!bytes) {return {available: false, blocker: "NO_SAVE", save};}
      const revision = signature(bytes);
      return revision === baseline ? {available: false, blocker: "UNCHANGED", save} : {available: true, blocker: null, revision, save};
    } catch {return {available: false, blocker: "FAILED", save};}
  };
  try {
    scope.signal.throwIfAborted();
    const module = await loader(new URL("player.mjs", new URL(config.runtimeBaseUrl, document.baseURI)).href);
    player = await module.createPlayer({canvas, files: index.files.map(f => ({path: f.path, size: f.sizeBytes})),
      saves: toCoreSaves(current), signal: scope.signal, read: files.read, audioContext: audio, audioDestination: gain,
      onSaveFile(name, bytes, deleted) {if (stopped) {return;} if (deleted) {delete current[name];} else {current[name] = bytes.slice();} changed++;},
      onError(error) {reportFailure(error); void exit();}, onStats(stats) {frameCount = stats.framesTotal;},
      onExit() {if (!stopped) {reportExit(); void exit();}},
    });
    scope.signal.throwIfAborted();
    if (player.info.width < 1 || player.info.height < 1) {throw new Error("SHIINA_FRAME_INVALID");}
    for (const type of ["keydown", "keyup"]) {frameWindow.addEventListener(type, keyEvent as EventListener);}
    for (const type of ["mousemove", "mousedown", "mouseup"]) {canvas.addEventListener(type, mouseEvent as EventListener);}
    frameWindow.addEventListener("blur", release); canvas.addEventListener("wheel", wheel, {passive: false});
    canvas.addEventListener("contextmenu", contextMenu); canvas.addEventListener("mousedown", unlock);
    content.signal?.addEventListener("abort", abort, {once: true}); unlock();
  } catch (error) {await exit(); throw error;}
  const active = () => {if (stopped) {throw new Error("SHIINA_RUNTIME_STOPPED");}};
  return {
    gamepadCursor: cursor, exit, getCanvas: () => stopped ? null : canvas,
    getDisplayAspectRatio: () => player!.info.width / player!.info.height,
    getFrameCount: () => frameCount, getCheckpointAvailability: availability,
    async checkpoint() {
      active(); if (!availability().available) {throw new Error("SHIINA_SAVE_UNAVAILABLE");}
      const files = fromCoreSaves(await player!.exportSaves());
      return {format: saveFormat, bytes: encodeSave(config.contentDigest, files)};
    },
    async acknowledgeCheckpoint(checkpoint: RuntimeCheckpoint) {
      active(); if (checkpoint.format !== saveFormat) {throw new Error("SHIINA_SAVE_INVALID");}
      decodeSave(checkpoint.bytes, config.contentDigest); baseline = signature(checkpoint.bytes);
    },
    async pause() {active(); paused = true; release(); cursor.setSuspended(true); player!.pause(true); await audio.suspend();},
    async resume() {active(); paused = false; cursor.setSuspended(false); player!.pause(false); await audio.resume();},
    async screenshot() {active(); return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));},
    setVolume(value) {gain.gain.value = Math.max(0, Math.min(1, value));},
  };
}
function virtualKey(event: KeyboardEvent) {
  if (event.keyCode > 0 && event.keyCode < 256) {return event.keyCode;}
  const special: Record<string, number> = {Enter: 13, Escape: 27, Space: 32, ControlLeft: 17, ControlRight: 17,
    ShiftLeft: 16, ShiftRight: 16, AltLeft: 18, AltRight: 18, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    PageUp: 33, PageDown: 34, Home: 36, End: 35, Backspace: 8, Tab: 9};
  return special[event.code] ?? (/^Key[A-Z]$/u.test(event.code) ? event.code.charCodeAt(3) : /^Digit\d$/u.test(event.code) ? event.code.charCodeAt(5) : 0);
}
function signature(bytes: Uint8Array) {return [...sha256(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");}
function toCoreSaves(files: SaveFiles) {
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => {
    let text = ""; for (let i = 0; i < bytes.length; i += 8192) {text += String.fromCharCode(...bytes.subarray(i, i + 8192));}
    return [name, btoa(text)];
  }));
}
function fromCoreSaves(value: Record<string, string>): SaveFiles {
  const files: SaveFiles = Object.create(null) as SaveFiles; let total = 0;
  if (!value || typeof value !== "object" || Object.keys(value).length > 256) {throw new Error("SHIINA_SAVE_INVALID");}
  for (const [name, base64] of Object.entries(value)) {
    if (typeof base64 !== "string" || base64.length > Math.ceil(maximumSaveBytes / 3) * 4) {throw new Error("SHIINA_SAVE_INVALID");}
    const text = atob(base64); total += text.length;
    if (total > maximumSaveBytes || btoa(text) !== base64) {throw new Error("SHIINA_SAVE_INVALID");}
    files[name] = Uint8Array.from(text, c => c.charCodeAt(0));
  }
  return files;
}
