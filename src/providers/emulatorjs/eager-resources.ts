import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {materializeFileBytes, requireContentSession} from "../../provider/content-inputs.js";
import {checkSignal} from "../../content-io/abort.js";
import {ContentIOError} from "../../content-io/errors.js";
import {optionalResource} from "./resources.js";
import type {EjsWindow} from "./emulator-instance.js";
import {zipSync} from "fflate";
import {canonicalPath} from "../../content-io/source.js";
import {contentFileName} from "./content-filename.js";

export async function prepareEagerROM(runtimeWindow: EjsWindow, file: {url: string; sha256: string; sizeBytes: number},
  session: AdapterContentSession, signal: AbortSignal, report: (ready: number, total: number) => void) {
  const bytes = await materializeFileBytes(session, file, session.inputPolicy("game"), "GAME", signal,
    progress => report(progress.readyBytes, progress.totalBytes));
  checkSignal(signal);
  if (bytes.byteLength !== file.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
  const name = contentFileName(file.url);
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor([bytes as Uint8Array<ArrayBuffer>], name);
}

export async function prepareEagerBIOS(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  content: AdapterContentSession | null, signal: AbortSignal, report: (ready: number, total: number) => void,
  release: "4.2.3" | "4.3.0-pre") {
  const bios = optionalResource(envelope, "bios", "BIOS_BUNDLE");
  if (!bios) {return () => {};}
  const session = requireContentSession(content), policy = session.inputPolicy("bios");
  const files: Record<string, Uint8Array<ArrayBuffer>> = Object.create(null);
  const totalBytes = bios.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (!bios.files.length || !Number.isSafeInteger(totalBytes) || totalBytes > policy.maxFileBytes) {throw new ContentIOError("BOUNDS");}
  let readyBytes = 0;
  for (const file of bios.files) {
    const path = file.virtualPath;
    if (!canonicalPath(path) || Object.hasOwn(files, path)) {throw new ContentIOError("SOURCE_INVALID");}
    const bytes = await materializeFileBytes(session, file, policy, "FIRMWARE", signal,
      progress => report(readyBytes + progress.readyBytes, totalBytes));
    checkSignal(signal);
    if (bytes.byteLength !== file.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
    files[path] = bytes as Uint8Array<ArrayBuffer>; readyBytes += bytes.byteLength;
  }
  checkSignal(signal);
  const bytes = zipSync(files, {level: 0});
  if (release === "4.3.0-pre") {
    // This release treats extensionless blob URLs as ordinary files. A realm-local
    // named File takes its explicit archive extraction path and preserves BIOS names.
    const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
    const archive = new FileConstructor([bytes as Uint8Array<ArrayBuffer>], "bundle.zip");
    runtimeWindow.EJS_biosUrl = archive;
    return () => {if (runtimeWindow.EJS_biosUrl === archive) {delete runtimeWindow.EJS_biosUrl;}};
  }
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  runtimeWindow.EJS_biosUrl = url;
  return () => {if (runtimeWindow.EJS_biosUrl === url) {delete runtimeWindow.EJS_biosUrl;} URL.revokeObjectURL(url);};
}
