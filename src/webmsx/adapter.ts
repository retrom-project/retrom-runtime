import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {fetchMedia, type MediaSource} from "./fetch.js";
import {loadWebMSX, type WebMSXLoader} from "./core.js";
import {installWebMSXGamepad} from "./input.js";

export type WebMSXParameters = MediaSource & {runtimeBaseUrl: string};
export const webmsxCheckpointMaximum = 32 * 1024 * 1024;
export async function mountWebMSX(config: WebMSXParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, signal?: AbortSignal,
  loader: WebMSXLoader = loadWebMSX): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restore &&
    (!restore.length || restore.length > webmsxCheckpointMaximum)) {throw new Error("WEBMSX_CONFIG_INVALID");}
  let cache: CacheStorage | undefined;
  try {cache = frameWindow.caches;} catch { /* Browser storage may be unavailable. */ }
  const bytes = await fetchMedia(config, progress, cache, signal);
  signal?.throwIfAborted();
  const module = await loader(new URL("webmsx.js", new URL(config.runtimeBaseUrl, window.location.href)).href, frameWindow, signal);
  signal?.throwIfAborted();
  const instance = await module.create({target, bytes, digest: config.contentDigest, restore}).catch((cause: unknown) => {
    // Core exceptions originate in the iframe and are not instanceof this realm's Error.
    const message = cause && typeof cause === "object" && "message" in cause ? cause.message : null;
    throw new Error(typeof message === "string" && /^WEBMSX_[A-Z0-9_]{1,80}$/u.test(message)
      ? message : "WEBMSX_RUNTIME_FAILED");
  });
  let exited = false;
  const canvas = instance.canvas;
  canvas.tabIndex = 0;
  const input = installWebMSXGamepad(frameWindow, canvas);
  const exit = async () => {
    if (exited) {return;}
    exited = true;
    input.dispose();
    try {instance.stop();} finally {target.replaceChildren();}
  };
  if (signal?.aborted) {await exit(); signal.throwIfAborted();}
  const active = () => {if (exited) {throw new Error("WEBMSX_STOPPED");}};
  return {
    canvasLayout: "CORE",
    checkpoint: async () => {
      active();
      const bytes = instance.checkpoint();
      if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > webmsxCheckpointMaximum) {
        throw new Error("WEBMSX_CHECKPOINT_INVALID");
      }
      return {format: "webmsx-state-v1", bytes: new Uint8Array(bytes)};
    },
    getCheckpointAvailability: () => exited ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    getCanvas: () => exited ? null : canvas,
    getFrameCount: () => null,
    pause: async () => {active(); input.pause(); instance.pause();},
    resume: async () => {active(); instance.resume(); input.resume();},
    screenshot: async () => {
      active();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob?.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return new Blob([await blob.arrayBuffer()], {type: "image/png"});
    },
    setVolume: null,
    exit,
  };
}
