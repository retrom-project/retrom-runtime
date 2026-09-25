import {eagerPolicy} from "../provider/content-policies.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {checkpointSize, transformCheckpoint} from "../provider/checkpoint-compression.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";

type File = {url: string; sha256: string; sizeBytes: number};
type BiosFile = File & {logicalName: string; virtualPath: string};
export type Apple2Parameters = {game: File; bios: BiosFile[]; runtimeBaseUrl: string};
type Bridge = {
  mount(input: {canvas: HTMLCanvasElement; systemRom: Uint8Array; characterRom: Uint8Array;
    diskRom: Uint8Array; diskName: string; diskBytes: Uint8Array}): Promise<{
      pause(): void; resume(): void; checkpoint(): string; restore(value: string): void; exit(): void;
    }>;
};
type Apple2Window = Window & {RetromApple2?: Bridge};

const biosPaths = new Map([
  ["AppleIIe.rom", {path: "roms/AppleIIe.rom", size: 16 * 1024}],
  ["apple2e-character.rom", {path: "roms/apple2e-character.rom", size: 4 * 1024}],
  ["AppleIIe_DiskII.rom", {path: "roms/AppleIIe_DiskII.rom", size: 256}],
]);
const maxCheckpointBytes = 32 * 1024 * 1024;

export async function mountApple2(config: Apple2Parameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, contentSession: AdapterContentSession,
  signal?: AbortSignal, restoreFormat?: string | null): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document ||
    restore && (!restore.length || restore.length > maxCheckpointBytes)) {invalid();}
  const bios = await loadBios(config.bios, contentSession, signal);
  const game = await materializeFileBytes(contentSession, config.game, eagerPolicy(32 * 1024 * 1024), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: config.game.sizeBytes}));
  const diskName = decodeURIComponent(new URL(config.game.url, frameWindow.document.baseURI).pathname.split("/").at(-1) ?? "game.dsk");
  const extension = diskName.split(".").at(-1)?.toLowerCase();
  if (!extension || !["2mg", "d13", "do", "dsk", "po", "nib", "woz"].includes(extension)) {invalid();}
  signal?.throwIfAborted();
  const iframe = frameWindow.document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:100%;border:0";
  iframe.setAttribute("allow", "autoplay; gamepad");
  iframe.src = new URL("index.html", new URL(config.runtimeBaseUrl, frameWindow.document.baseURI)).href;
  let session: Awaited<ReturnType<Bridge["mount"]>> | undefined;
  let canvas: HTMLCanvasElement | null = null;
  let exited = false;
  const focus = () => iframe.focus();
  const cleanup = () => {if (exited) {return;} exited = true; session?.exit(); iframe.remove();};
  try {
    target.replaceChildren(iframe);
    const bridge = await ready(iframe, signal);
    canvas = iframe.contentDocument?.querySelector("canvas") ?? null;
    if (!canvas) {invalid();}
    canvas.setAttribute("aria-label", "Apple II game");
    session = await bridge.mount({canvas, systemRom: bios["AppleIIe.rom"],
      characterRom: bios["apple2e-character.rom"], diskRom: bios["AppleIIe_DiskII.rom"],
      diskName: `game.${extension}`, diskBytes: new Uint8Array(game)});
    if (restore) {
      const raw = await decodeApple2State(restore, restoreFormat, signal);
      session.restore(new TextDecoder("utf-8", {fatal: true}).decode(raw));
    }
    signal?.throwIfAborted();
    iframe.contentDocument?.addEventListener("pointerdown", focus, true);
    focus();
  } catch (error) {cleanup(); throw error;}
  const active = () => {if (exited || !session || !canvas) {throw new Error("APPLE2JS_STOPPED");}};
  return {
    canvasLayout: "CORE",
    checkpoint: async () => {
      active();
      const bytes = new TextEncoder().encode(session!.checkpoint());
      checkpointSize(bytes, maxCheckpointBytes);
      return {format: "apple2js-state-v1", bytes};
    },
    getCheckpointAvailability: () => exited ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    getCanvas: () => exited ? null : canvas,
    getFrameCount: () => null,
    pause: async () => {active(); session!.pause();},
    resume: async () => {active(); session!.resume(); focus();},
    screenshot: async () => {
      active();
      const blob = await new Promise<Blob | null>((resolve) => canvas!.toBlob(resolve, "image/png"));
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
    const bridge = (iframe.contentWindow as Apple2Window | null)?.RetromApple2;
    if (typeof bridge?.mount === "function") {return bridge;}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("APPLE2JS_RUNTIME_FAILED");
}

function invalid(): never {throw new Error("APPLE2JS_CONFIG_INVALID");}

async function loadBios(files: BiosFile[], contentSession: AdapterContentSession, signal?: AbortSignal) {
  if (files.length !== biosPaths.size) {invalid();}
  const bios: Record<string, Uint8Array> = {};
  for (const file of files) {
    const expected = biosPaths.get(file.logicalName);
    if (!expected || file.virtualPath !== expected.path || file.sizeBytes !== expected.size || bios[file.logicalName]) {invalid();}
    bios[file.logicalName] = await materializeFileBytes(contentSession, file, eagerPolicy(expected.size), "FIRMWARE", signal);
  }
  return bios;
}

async function decodeApple2State(bytes: Uint8Array, format: string | null | undefined, signal?: AbortSignal) {
  if (format === "apple2js-state-v1" || format === "apple2js-state-v1-storage-v1") {return bytes;}
  if (format === "apple2js-state-gzip-v1" || format === "apple2js-state-gzip-v1-storage-v1") {
    return transformCheckpoint(bytes, true, 64 * 1024 * 1024, signal);
  }
  invalid();
}
