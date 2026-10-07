import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {fileContentSource, requireContentSession} from "../../provider/content-inputs.js";
import {checkSignal} from "../../content-io/abort.js";
import {ContentIOError} from "../../content-io/errors.js";
import {optionalResource} from "./resources.js";
import type {EjsWindow} from "./emulator-instance.js";
import {contentFileName} from "./content-filename.js";

/** Keep a verified Parent archive intact for the core's named ZIP lookup. */
export async function prepareParentContent(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  optionalSession: AdapterContentSession | null, signal: AbortSignal,
  report: (readyBytes: number, totalBytes: number) => void,
  releaseVersion: "4.2.3" | "4.3.0-pre"): Promise<() => Promise<void>> {
  const parent = optionalResource(envelope, "parent", "PARENT_ARCHIVE");
  if (!parent) {return async () => {};}
  const session = requireContentSession(optionalSession), policy = session.inputPolicy("parent");
  const reader = await session.open(fileContentSource(parent, policy), policy, signal);
  let release: (() => Promise<void>) | undefined;
  let localParent: string | File | undefined, closed = false;
  const abort = () => {void cleanup().catch(() => {});};
  const cleanup = async () => {
    if (closed) {return;} closed = true;
    signal.removeEventListener("abort", abort);
    if (localParent) {
      if (runtimeWindow.EJS_gameParentUrl === localParent) {delete runtimeWindow.EJS_gameParentUrl;}
      if (typeof localParent === "string") {URL.revokeObjectURL(localParent);}
    }
    try {await release?.();} finally {await reader.close();}
  };
  try {
    const result = await session.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, signal,
      progress => report(progress.readyBytes, progress.totalBytes));
    if (result.kind !== "BLOB") {throw new ContentIOError("INTERNAL");}
    release = result.release;
    checkSignal(signal);
    if (result.blob.size !== parent.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
    if (releaseVersion === "4.3.0-pre") {
      const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
      localParent = new FileConstructor([result.blob], contentFileName(parent.url));
    } else {
      // 4.2.3 has a string-only cache lookup before its File handling.
      localParent = URL.createObjectURL(result.blob);
    }
    runtimeWindow.EJS_gameParentUrl = localParent;
    signal.addEventListener("abort", abort, {once: true});
    return cleanup;
  } catch (error) {await cleanup(); throw error;}
}
