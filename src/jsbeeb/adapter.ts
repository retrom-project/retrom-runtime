import {eagerPolicy} from "../provider/content-policies.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";

type File = {url: string; sha256: string; sizeBytes: number};
type BiosFile = File & {logicalName: string; virtualPath: string};
export type JsbeebParameters = {game: File; bios: BiosFile[]; runtimeBaseUrl: string};
type Bridge = {
  canvas: HTMLCanvasElement;
  checkpoint(): Promise<Uint8Array>;
  restore(bytes: Uint8Array): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
};
type JsbeebWindow = Window & {RetromJsbeeb?: Bridge; RetromJsbeebBios?: Record<string, Uint8Array>};

const maximumCheckpointBytes = 32 * 1024 * 1024;
const biosPaths = new Map([
  ["os.rom", "roms/os.rom"],
  ["BASIC.ROM", "roms/BASIC.ROM"],
  ["DFS-1.2.rom", "roms/b/DFS-1.2.rom"],
]);

export async function mountJsbeeb(config: JsbeebParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, contentSession: AdapterContentSession,
  signal?: AbortSignal): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || config.bios.length !== biosPaths.size ||
    restore && (!restore.length || restore.length > maximumCheckpointBytes)) {invalid();}
  const bios: Record<string, Uint8Array> = {};
  for (const file of config.bios) {
    const path = biosPaths.get(file.logicalName);
    if (!path || file.virtualPath !== path || bios[path]) {invalid();}
    bios[path] = await materializeFileBytes(contentSession, file, eagerPolicy(1024 * 1024), "FIRMWARE", signal);
  }
  const game = await materializeFileBytes(contentSession, config.game, eagerPolicy(32 * 1024 * 1024), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: config.game.sizeBytes}));
  signal?.throwIfAborted();
  const extension = /\.(ssd|dsd|adf|hfe)$/iu.exec(new URL(config.game.url, frameWindow.location.href).pathname)?.[1];
  if (!extension) {invalid();}
  const url = URL.createObjectURL(new Blob([new Uint8Array(game)]));
  const host = frameWindow as JsbeebWindow;
  const iframe = frameWindow.document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:100%;border:0";
  iframe.setAttribute("allow", "autoplay; gamepad");
  const entry = new URL("index.html", config.runtimeBaseUrl);
  entry.searchParams.set("retrom", "1");
  entry.searchParams.set("disc1", `${url}#game.${extension.toLowerCase()}`);
  entry.searchParams.set("autoboot", "1");
  let bridge: Bridge;
  let exited = false;
  const cleanup = () => {
    if (exited) {return;}
    exited = true;
    try {bridge?.stop();} finally {
      iframe.remove();
      delete host.RetromJsbeebBios;
      URL.revokeObjectURL(url);
    }
  };
  try {
    host.RetromJsbeebBios = bios;
    iframe.src = entry.href;
    target.replaceChildren(iframe);
    bridge = await ready(iframe, signal);
    if (restore) {await bridge.restore(new Uint8Array(restore));}
    signal?.throwIfAborted();
  } catch (error) {cleanup(); throw error;}
  const active = () => {if (exited) {throw new Error("JSBEEB_STOPPED");}};
  return {
    canvasLayout: "CORE",
    checkpoint: async () => {
      active();
      const bytes = await bridge.checkpoint();
      if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > maximumCheckpointBytes) {invalid();}
      return {format: "jsbeeb-snapshot-gzip-v1", bytes: new Uint8Array(bytes)};
    },
    getCheckpointAvailability: () => exited ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    getCanvas: () => exited ? null : bridge.canvas,
    getFrameCount: () => null,
    pause: async () => {active(); bridge.pause();},
    resume: async () => {active(); bridge.resume();},
    screenshot: async () => {
      active();
      const blob = await new Promise<Blob | null>((resolve) => bridge.canvas.toBlob(resolve, "image/png"));
      if (!blob?.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return new Blob([await blob.arrayBuffer()], {type: "image/png"});
    },
    setVolume: null,
    exit: async () => cleanup(),
  };
}

async function ready(iframe: HTMLIFrameElement, signal?: AbortSignal): Promise<Bridge> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const bridge = (iframe.contentWindow as JsbeebWindow | null)?.RetromJsbeeb;
    if (bridge?.canvas && typeof bridge.checkpoint === "function" && typeof bridge.restore === "function") {
      return bridge;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("JSBEEB_RUNTIME_FAILED");
}

function invalid(): never {throw new Error("JSBEEB_CONFIG_INVALID");}
