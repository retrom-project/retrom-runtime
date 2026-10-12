import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {materializeFileBytes, requireContentSession} from "../../provider/content-inputs.js";
import {installFlycastCompatibility} from "./flycast.js";
import {resource} from "./resources.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {fileContentSource} from "../../provider/content-inputs.js";
import {createFlycastRange, createNeoCDRange, NeoCDRange} from "./neocd-range.js";
import {EagerContentFile} from "./eager-content-file.js";
import {prepareEagerROM} from "./eager-resources.js";
import type {EjsWindow} from "./emulator-instance.js";
import {contentFileName} from "./content-filename.js";
import {FlycastFiles} from "./flycast-files.js";
import {optionalResource} from "./resources.js";

export function emulatorJsDisableCue(core: string): boolean {
  return ["cap32", "quasi88", "flycast"].includes(core);
}

/** The WASM core's real BIOS MIL-CD boot path traps; CDI boots via its HLE loader. */
export function flycastDiscBootOptions(core: string, url: string): Record<string, string> {
  return core === "flycast" && new URL(url, "https://retrom.invalid").pathname.toLowerCase().endsWith(".cdi")
    ? {reicast_hle_bios: "enabled"} : {};
}

export function isFlycastArcadeTarget(targetId: string) {
  return ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"].includes(targetId);
}

export async function mountNeoCDRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: AdapterContentSession): Promise<ReturnType<typeof createNeoCDRange>> {
  const policy = session.inputPolicy("game");
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createNeoCDRange(disc, reader, fail);
  runtimeWindow.RETROM_NEOCD_RANGE = range;
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_NEOCD_RANGE_V1"], range.filename);
  return range;
}

export async function mountSeekableContentRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: AdapterContentSession): Promise<ReturnType<typeof createNeoCDRange>> {
  const policy = session.inputPolicy("game");
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = new NeoCDRange(disc, reader, fail, contentFileName(disc.url));
  // The emulator may inspect both ends of a disc before its first frame.
  try {await Promise.all([range.read(0, 1), range.read(disc.sizeBytes - 1, 1)]);}
  catch (error) {await range.dispose(); throw error;}
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_CONTENT_IO_FILE_V1"], range.filename);
  return range;
}

export async function mountEagerContentFile(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: AdapterContentSession,
  report: (readyBytes: number, totalBytes: number) => void = () => {}) {
  const bytes = await materializeFileBytes(session, disc, session.inputPolicy("game"), "GAME", signal,
    progress => report(progress.readyBytes, progress.totalBytes));
  if (bytes.byteLength !== disc.sizeBytes) {throw new Error("EMULATORJS_CONTENT_FILE_LENGTH_MISMATCH");}
  const file = new EagerContentFile(disc.url, disc.sha256, bytes, fail);
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_CONTENT_IO_FILE_V1"], file.filename);
  return file;
}

export async function mountFlycastRange(runtimeWindow: EjsWindow,
  disc: {url: string; sha256: string; sizeBytes: number}, targetId: string,
  signal: AbortSignal, fail: (error: Error) => void, session: AdapterContentSession,
  files: ReadonlyArray<{virtualPath: string; url: string; sha256: string; sizeBytes: number}> = []) {
  const policy = session.inputPolicy("game");
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createFlycastRange(disc, flycastContentName(disc.url, disc.sha256, targetId), reader, fail);
  const opened = [range];
  try {
    const dependencies = [];
    for (const file of files) {
      const policy = session.inputPolicy("game-files");
      const reader = await session.open(fileContentSource(file, policy), policy, signal);
      const mounted = createFlycastRange(file, file.virtualPath, reader, fail);
      opened.push(mounted); dependencies.push({path: `/${file.virtualPath}`, range: mounted});
    }
    const bridge = new FlycastFiles(range, dependencies, fail);
    runtimeWindow.RETROM_FLYCAST_RANGE = bridge;
    const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
    runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_FLYCAST_RANGE_V1"], range.filename);
    return bridge.contentFile;
  } catch (error) {await Promise.all(opened.map(file => file.dispose())); throw error;}
}

export function flycastContentName(url: string, sha256: string, targetId: string): string {
  if (targetId === "flycast") {
    const extension = contentFileName(url).split(".").at(-1)?.toLowerCase();
    if (!extension || !["bin", "cdi", "chd", "cue", "dat", "elf", "gdi", "lst", "m3u"].includes(extension)) {
      throw new Error("FLYCAST_CONTENT_NAME_INVALID");
    }
    return `${sha256}.${extension}`;
  }
  if (!isFlycastArcadeTarget(targetId) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(url)) {throw new Error("FLYCAST_CONTENT_NAME_INVALID");}
  const pathname = new URL(url, "https://retrom.invalid").pathname;
  const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  if (name.length > 255 || !/^[a-z0-9][a-z0-9._-]*\.zip$/iu.test(name) || name.includes("..")) {
    throw new Error("FLYCAST_CONTENT_NAME_INVALID");
  }
  return name.toLowerCase();
}

export function hasSeekableGame(envelope: LaunchEnvelopeV1): boolean {
  return envelope.resources.some(entry => entry.role === "game" && entry.kind === "SEEKABLE_BLOB");
}

export function gameResourceURL(envelope: LaunchEnvelopeV1, core: string, seekable: boolean) {
  // DOS receives its virtual File before the EJS loader starts.
  return core === "dosbox_pure" ? "game.zip" :
    resource(envelope, "game", seekable ? "SEEKABLE_BLOB" : "ROM_BLOB").url;
}

export function asyncRangeCore(core: string) {return ["neocd", "flycast", "daphne", "dosbox_pure"].includes(core);}

export function mountRangeFS(core: string, seekable: boolean, eager: boolean, daphne: boolean) {
  return (seekable || eager || daphne || core === "dosbox_pure") && !["neocd", "flycast"].includes(core);
}

export async function configureContentDisc(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1, core: string,
  signal: AbortSignal, session: AdapterContentSession | null, fail: (error: Error) => void,
  eager = false, report: (readyBytes: number, totalBytes: number) => void = () => {}) {
  if (eager) {
    const game = resource(envelope, "game", "ROM_BLOB");
    return {range: await mountEagerContentFile(runtimeWindow, game, signal, fail, requireContentSession(session), report), cleanup: null};
  }
  const eagerGame = envelope.resources.find(entry => entry.role === "game" && entry.kind === "ROM_BLOB");
  if (eagerGame?.kind === "ROM_BLOB" && requireContentSession(session).inputPolicy("game").mode === "EAGER") {
    await prepareEagerROM(runtimeWindow, eagerGame, requireContentSession(session), signal, report);
    return {range: null, cleanup: null};
  }
  const seekable = hasSeekableGame(envelope);
  if (!seekable) {return {range: null, cleanup: null};}
  const game = resource(envelope, "game", "SEEKABLE_BLOB");
  if (core === "neocd") {return {range: await mountNeoCDRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  if (core !== "flycast") {return {range: await mountSeekableContentRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  const cleanup = installFlycastCompatibility(runtimeWindow);
  try {
    return {range: await mountFlycastRange(runtimeWindow, game, envelope.runtime.targetId,
      signal, fail, requireContentSession(session), optionalResource(envelope, "game-files", "EXTERNAL_FILE_SET")?.files), cleanup};
  } catch (error) {cleanup(); throw error;}
}
