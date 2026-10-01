import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {fileContentSource, requireContentSession} from "../../provider/content-inputs.js";
import {checkSignal} from "../../content-io/abort.js";
import {ContentIOError} from "../../content-io/errors.js";
import {optionalResource} from "./resources.js";
import type {EjsWindow} from "./emulator-instance.js";

/** Keep the upstream ZIP extraction while owning immutable parent downloads and their lifetime. */
export async function prepareParentContent(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  optionalSession: AdapterContentSession | null, signal: AbortSignal,
  report: (readyBytes: number, totalBytes: number) => void = () => {}): Promise<() => Promise<void>> {
  const parent = optionalResource(envelope, "parent", "PARENT_ARCHIVE");
  if (!parent) {return async () => {};}
  const session = requireContentSession(optionalSession), policy = session.inputPolicy("parent");
  const reader = await session.open(fileContentSource(parent, policy), policy, signal);
  let release: (() => Promise<void>) | undefined;
  let url: string | undefined, closed = false;
  const abort = () => {void cleanup().catch(() => {});};
  const cleanup = async () => {
    if (closed) {return;} closed = true;
    signal.removeEventListener("abort", abort);
    if (url) {
      if (runtimeWindow.EJS_gameParentUrl === url) {delete runtimeWindow.EJS_gameParentUrl;}
      URL.revokeObjectURL(url);
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
    // A URL also supports 4.2.3's string-only cache lookup before its File handling.
    url = URL.createObjectURL(result.blob);
    runtimeWindow.EJS_gameParentUrl = url;
    signal.addEventListener("abort", abort, {once: true});
    return cleanup;
  } catch (error) {await cleanup(); throw error;}
}
