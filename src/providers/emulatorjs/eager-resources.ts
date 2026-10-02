import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {materializeFileBytes, requireContentSession} from "../../provider/content-inputs.js";
import {checkSignal} from "../../content-io/abort.js";
import {ContentIOError} from "../../content-io/errors.js";
import {optionalResource} from "./resources.js";
import type {EjsWindow} from "./emulator-instance.js";

export async function prepareEagerROM(runtimeWindow: EjsWindow, file: {url: string; sha256: string; sizeBytes: number},
  session: AdapterContentSession, signal: AbortSignal, report: (ready: number, total: number) => void) {
  const bytes = await materializeFileBytes(session, file, session.inputPolicy("game"), "GAME", signal,
    progress => report(progress.readyBytes, progress.totalBytes));
  checkSignal(signal);
  if (bytes.byteLength !== file.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
  const path = new URL(file.url, location.href).pathname;
  const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  if (!name || name.length > 255 || name === "." || name === ".." || /[/\\]/u.test(name) || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new ContentIOError("SOURCE_INVALID");
  }
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor([bytes as Uint8Array<ArrayBuffer>], name);
}

export async function prepareEagerBIOS(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  content: AdapterContentSession | null, signal: AbortSignal, report: (ready: number, total: number) => void) {
  const bios = optionalResource(envelope, "bios", "BIOS_BUNDLE");
  if (!bios) {return () => {};}
  if (bios.files.length !== 1 || bios.files[0].logicalName !== "bundle.zip") {throw new ContentIOError("SOURCE_INVALID");}
  const session = requireContentSession(content), file = bios.files[0];
  const bytes = await materializeFileBytes(session, file, session.inputPolicy("bios"), "FIRMWARE", signal,
    progress => report(progress.readyBytes, progress.totalBytes));
  checkSignal(signal);
  if (bytes.byteLength !== file.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  runtimeWindow.EJS_biosUrl = url;
  return () => {if (runtimeWindow.EJS_biosUrl === url) {delete runtimeWindow.EJS_biosUrl;} URL.revokeObjectURL(url);};
}
