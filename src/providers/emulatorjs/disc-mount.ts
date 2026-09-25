import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {requireContentSession} from "../../provider/content-inputs.js";
import {installFlycastCompatibility} from "./flycast.js";
import {resource} from "./resources.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {fileContentSource} from "../../provider/content-inputs.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";
import {loadFlycastDisc} from "./flycast-cache.js";
import {createNeoCDRange} from "./neocd-range.js";
import type {EjsWindow} from "./emulator-instance.js";

export function emulatorJsDisableCue(core: string, targetId: string): boolean {
  return ["cap32", "quasi88"].includes(core) || core === "flycast" &&
    ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"].includes(targetId);
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

export async function loadFlycastFile(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  targetId: string, signal: AbortSignal, progress: (loaded: number, total: number) => void, session: ContentSessionClient) {
  const blob = await loadFlycastDisc(disc, signal, progress, session);
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  return new FileConstructor([blob], flycastContentName(disc.url, disc.sha256, targetId));
}

export function flycastContentName(url: string, sha256: string, targetId: string): string {
  if (targetId === "flycast") {return `${sha256}.chd`;}
  if (!["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"].includes(targetId) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(url)) {throw new Error("FLYCAST_CONTENT_NAME_INVALID");}
  const pathname = new URL(url, "https://retrom.invalid").pathname;
  const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  if (name.length > 255 || !/^[a-z0-9][a-z0-9._-]*\.zip$/iu.test(name) || name.includes("..")) {
    throw new Error("FLYCAST_CONTENT_NAME_INVALID");
  }
  return name;
}

export async function configureContentDisc(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1, core: string,
  signal: AbortSignal, session: ContentSessionClient | null, fail: (error: Error) => void,
  progress: (value: {loadedBytes: number; totalBytes: number}) => void) {
  if (core !== "flycast" && core !== "neocd") {return {range: null, cleanup: null};}
  const game = resource(envelope, "game", core === "neocd" ? "SEEKABLE_BLOB" : "ROM_BLOB");
  if (core === "neocd") {return {range: await mountNeoCDRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  const cleanup = installFlycastCompatibility(runtimeWindow);
  try {
    runtimeWindow.EJS_gameUrl = await loadFlycastFile(runtimeWindow, game, envelope.runtime.targetId, signal,
      (loadedBytes, totalBytes) => progress({loadedBytes, totalBytes}), requireContentSession(session));
    return {range: null, cleanup};
  } catch (error) {cleanup(); throw error;}
}
