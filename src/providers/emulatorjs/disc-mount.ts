import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {requireContentSession} from "../../provider/content-inputs.js";
import {installFlycastCompatibility} from "./flycast.js";
import {resource} from "./resources.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {fileContentSource} from "../../provider/content-inputs.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";
import {createFlycastRange, createNeoCDRange} from "./neocd-range.js";
import type {EjsWindow} from "./emulator-instance.js";

export function emulatorJsDisableCue(core: string, targetId: string): boolean {
  return ["cap32", "quasi88"].includes(core) || core === "flycast" &&
    isFlycastArcadeTarget(targetId);
}

export function isFlycastArcadeTarget(targetId: string) {
  return ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"].includes(targetId);
}

export async function mountNeoCDRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: ContentSessionClient): Promise<ReturnType<typeof createNeoCDRange>> {
  const policy = rangePolicy("ASYNC", contentLimits.signedDisc);
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createNeoCDRange(disc, reader, fail);
  runtimeWindow.RETROM_NEOCD_RANGE = range;
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_NEOCD_RANGE_V1"], range.filename);
  return range;
}

export async function mountSeekableContentRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: ContentSessionClient): Promise<ReturnType<typeof createNeoCDRange>> {
  const policy = rangePolicy("ASYNC", contentLimits.signedDisc);
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createNeoCDRange(disc, reader, fail);
  // The emulator may inspect both ends of a disc before its first frame.
  try {await Promise.all([range.read(0, 1), range.read(disc.sizeBytes - 1, 1)]);}
  catch (error) {await range.dispose(); throw error;}
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_CONTENT_IO_FILE_V1"], range.filename);
  return range;
}

export async function mountFlycastRange(runtimeWindow: EjsWindow,
  disc: {url: string; sha256: string; sizeBytes: number}, targetId: string,
  signal: AbortSignal, fail: (error: Error) => void, session: ContentSessionClient) {
  const policy = rangePolicy("ASYNC", contentLimits.signedDisc);
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createFlycastRange(disc, flycastContentName(disc.url, disc.sha256, targetId), reader, fail);
  runtimeWindow.RETROM_FLYCAST_RANGE = range;
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_FLYCAST_RANGE_V1"], range.filename);
  return range;
}

export function flycastContentName(url: string, sha256: string, targetId: string): string {
  if (targetId === "flycast") {return `${sha256}.chd`;}
  if (!isFlycastArcadeTarget(targetId) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(url)) {throw new Error("FLYCAST_CONTENT_NAME_INVALID");}
  const pathname = new URL(url, "https://retrom.invalid").pathname;
  const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  if (name.length > 255 || !/^[a-z0-9][a-z0-9._-]*\.zip$/iu.test(name) || name.includes("..")) {
    throw new Error("FLYCAST_CONTENT_NAME_INVALID");
  }
  return name;
}

export function hasSeekableGame(envelope: LaunchEnvelopeV1): boolean {
  return envelope.resources.some(entry => entry.role === "game" && entry.kind === "SEEKABLE_BLOB");
}

export async function configureContentDisc(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1, core: string,
  signal: AbortSignal, session: ContentSessionClient | null, fail: (error: Error) => void) {
  const seekable = hasSeekableGame(envelope);
  if (!seekable) {return {range: null, cleanup: null};}
  const game = resource(envelope, "game", "SEEKABLE_BLOB");
  if (core === "neocd") {return {range: await mountNeoCDRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  if (core !== "flycast") {return {range: await mountSeekableContentRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  const cleanup = installFlycastCompatibility(runtimeWindow);
  try {
    return {range: await mountFlycastRange(runtimeWindow, game, envelope.runtime.targetId,
      signal, fail, requireContentSession(session)), cleanup};
  } catch (error) {cleanup(); throw error;}
}
