import {eagerPolicy} from "../provider/content-policies.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {installSamGamepad} from "./input.js";
import {decodeSamDisk, encodeSamDisk, maxDiskBytes, saveFormat} from "./state.js";

type File = {url: string; sha256: string; sizeBytes: number};
type Bios = File & {logicalName: string; virtualPath: string};
export type SamCoupeParameters = {game: File; bios: Bios[]; runtimeBaseUrl: string};
type SamModule = {
  FS: {
    mkdir(path: string): void;
    readFile(path: string): Uint8Array;
    writeFile(path: string, bytes: Uint8Array): void;
  };
  ccall(name: string, result: "number" | null, args: string[], values: unknown[]): number;
};
type SamWindow = Window & {Module?: SamModule; Uint8Array: Uint8ArrayConstructor};
const save = {capture: "IN_GAME", restore: "AUTOMATIC", captureAvailable: false, dataKind: "PROGRESS"} as const;

export async function mountSamCoupe(config: SamCoupeParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, contentSession: AdapterContentSession,
  failure: (error: Error) => void, signal?: AbortSignal): Promise<MountedRuntimeAdapter> {
  const {bios, game, restoredDisk, extension} = await loadMedia(config, target, frameWindow, restore, progress, contentSession, signal);
  const diskPath = `/media/game.${extension}`;
  const writableDisk = extension !== "sbt";
  const {iframe, realm, canvas} = createFrame(target, frameWindow);
  const base = new URL(config.runtimeBaseUrl, frameWindow.location.href);
  const ByteArray = realm.Uint8Array;
  let stopped = false, startedAt = 0, engineError: Error | null = null;
  let input: ReturnType<typeof installSamGamepad> | null = null;
  const active = () => {
    if (stopped || engineError) {throw engineError ?? new Error("SAMCOUPE_STOPPED");}
    const module = realm.Module;
    if (!module?.FS || !module.ccall) {throw new Error("SAMCOUPE_RUNTIME_UNAVAILABLE");}
    return module;
  };
  const abort = () => {void exit();};
  const exit = async () => {
    if (stopped) {return;}
    stopped = true;
    signal?.removeEventListener("abort", abort);
    input?.dispose();
    iframe.remove();
  };
  signal?.addEventListener("abort", abort, {once: true});
  try {
    const runtimeConfig = {
      canvas,
      arguments: ["-usewebgl", "0", "-voicebox", "0", "-rom", "/Resource/samcoupe.rom"],
      locateFile: (name: string) => new URL(name, base).href,
      preRun: [() => {
        const fs = realm.Module!.FS;
        fs.mkdir("/media");
        fs.writeFile("/Resource/samcoupe.rom", new ByteArray(bios));
        fs.writeFile(diskPath, new ByteArray(restoredDisk ?? game));
      }],
      print: (message: string) => {if (message.includes("Main::Init: Success!")) {startedAt = Date.now();}},
      printErr: (_message: string) => undefined,
      onAbort: () => {engineError = new Error("SAMCOUPE_CORE_ABORTED"); if (!stopped) {failure(engineError);}},
    };
    Object.assign(realm, {Module: runtimeConfig});
    const script = realm.document.createElement("script");
    script.src = new URL("samcoupeweb.js", base).href;
    script.onerror = () => {engineError = new Error("SAMCOUPE_CORE_LOAD_FAILED");};
    realm.document.head.append(script);
    await waitForGameFrame(realm, active, diskPath, () => startedAt > 0 && Date.now() - startedAt >= 500,
      () => engineError, signal);
    canvas.focus();
    input = installSamGamepad(frameWindow, realm, canvas);
  } catch (error) {await exit(); throw error;}

  const availability = () => {
    if (stopped || engineError) {return {available: false, blocker: "NOT_READY", save} as const;}
    return writableDisk && active().ccall("EMS_IsDiskModified", "number", ["number"], [0])
      ? {available: true, blocker: null, save} as const
      : {available: false, blocker: "UNCHANGED", save} as const;
  };
  return {
    canvasLayout: "CORE",
    checkpoint: async () => {
      if (!availability().available) {throw new Error("SAMCOUPE_SAVE_UNAVAILABLE");}
      const module = active();
      module.ccall("EMS_FlushDisk", null, ["number"], [0]);
      return {format: saveFormat, bytes: encodeSamDisk(config.game.sha256, module.FS.readFile(diskPath))};
    },
    acknowledgeCheckpoint: async checkpoint => {
      if (checkpoint.format !== saveFormat) {invalid();}
      decodeSamDisk(config.game.sha256, checkpoint.bytes);
      active().ccall("EMS_ClearDiskModified", null, ["number"], [0]);
    },
    getCheckpointAvailability: availability,
    getCanvas: () => stopped ? null : canvas,
    getFrameCount: () => null,
    pause: async () => {input?.pause(); active().ccall("EMS_SetOption", null, ["string", "number"], ["pause", 1]);},
    resume: async () => {active().ccall("EMS_SetOption", null, ["string", "number"], ["pause", 0]); input?.resume();},
    screenshot: async () => {
      active();
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob?.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return new Blob([await blob.arrayBuffer()], {type: "image/png"});
    },
    setVolume: null,
    exit,
  };
}

function invalid(): never {throw new Error("SAMCOUPE_CONFIG_INVALID");}

async function loadMedia(config: SamCoupeParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, contentSession: AdapterContentSession,
  signal?: AbortSignal) {
  if (target.ownerDocument !== frameWindow.document || config.bios.length !== 1 ||
    config.bios[0].logicalName !== "samcoupe.rom" ||
    config.bios[0].virtualPath !== "Resource/samcoupe.rom") {invalid();}
  const extension = /\.(dsk|mgt|sad|sbt)$/iu.exec(new URL(config.game.url, config.runtimeBaseUrl).pathname)?.[1]?.toLowerCase();
  if (!extension || config.game.sizeBytes > maxDiskBytes) {invalid();}
  const restoredDisk = restore ? decodeSamDisk(config.game.sha256, restore) : null;
  const bios = await materializeFileBytes(contentSession, config.bios[0], eagerPolicy(32768), "FIRMWARE", signal);
  if (bios.byteLength !== 32768) {invalid();}
  const game = await materializeFileBytes(contentSession, config.game, eagerPolicy(maxDiskBytes), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: config.game.sizeBytes}));
  if (!game.byteLength || game.byteLength > maxDiskBytes) {invalid();}
  signal?.throwIfAborted();
  return {bios, game, restoredDisk, extension};
}

function createFrame(target: HTMLElement, frameWindow: Window) {
  const iframe = frameWindow.document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:100%;border:0";
  iframe.setAttribute("allow", "autoplay; gamepad");
  target.replaceChildren(iframe);
  const realm = iframe.contentWindow as SamWindow | null;
  if (!realm) {iframe.remove(); invalid();}
  const canvas = realm.document.createElement("canvas");
  canvas.id = "canvas";
  canvas.width = 512; canvas.height = 192; canvas.tabIndex = 0;
  canvas.style.cssText = "width:100%;height:auto;image-rendering:pixelated";
  realm.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  realm.document.body.append(canvas);
  return {iframe, realm, canvas};
}

async function waitForGameFrame(realm: SamWindow, active: () => SamModule, diskPath: string,
  started: () => boolean, failed: () => Error | null, signal?: AbortSignal) {
  const deadline = Date.now() + 30_000;
  let inserted = false;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (failed()) {throw failed();}
    if (started() && !inserted) {
      // The machine ROM and disk are supplied by Launch, never by the core archive.
      const module = active();
      if (module.ccall("EMS_InsertDisk", "number", ["number", "string"], [0, diskPath]) !== 1) {
        throw new Error("SAMCOUPE_DISK_INSERT_FAILED");
      }
      module.ccall("EMS_Boot", null, ["number"], [1]);
      inserted = true;
    }
    if (inserted && active().ccall("EMS_GetFPS", "number", [], []) > 0) {return;}
    await new Promise(resolve => realm.setTimeout(resolve, 50));
  }
  throw new Error("SAMCOUPE_START_TIMEOUT");
}
