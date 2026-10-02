import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {fileContentSource, requireContentSession, type AdapterContentSession} from "../../provider/content-inputs.js";
import {checkSignal} from "../../content-io/abort.js";
import {ContentIOError} from "../../content-io/errors.js";
import {optionalResource} from "./resources.js";
import type {EjsWindow} from "./emulator-instance.js";

/** Upstream mounts local URLs; the Provider owns verified raw bytes and their leases. */
export async function prepareExternalContent(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  optionalSession: AdapterContentSession | null, signal: AbortSignal,
  report: (ready: number, total: number) => void = () => {}): Promise<() => Promise<void>> {
  const files = [
    ...(optionalResource(envelope, "external", "EXTERNAL_FILE_SET")?.files ?? []).map(file =>
      ({file, path: file.virtualPath, role: "external", purpose: "FIRMWARE" as const})),
    ...(optionalResource(envelope, "discs", "MULTI_DISC")?.entries ?? []).map(file =>
      ({file, path: `/disc-${String(file.index + 1).padStart(3, "0")}.chd`, role: "discs", purpose: "GAME" as const})),
  ];
  if (!files.length) {return async () => {};}
  const session = requireContentSession(optionalSession), urls: Record<string, string> = {};
  const releases: Array<() => Promise<void>> = [];
  let closed = false;
  const cleanup = async () => {
    if (closed) {return;} closed = true;
    signal.removeEventListener("abort", abort);
    if (runtimeWindow.EJS_externalFiles === urls) {delete runtimeWindow.EJS_externalFiles;}
    for (const url of Object.values(urls)) {URL.revokeObjectURL(url);}
    await Promise.all(releases.map(release => release()));
  };
  const abort = () => {void cleanup().catch(() => {});};
  try {
    for (const {file, path, role, purpose} of files) {
      const policy = session.inputPolicy(role);
      const reader = await session.open(fileContentSource(file, policy, purpose), policy, signal);
      try {
        const result = await session.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, signal,
          progress => report(progress.readyBytes, progress.totalBytes));
        if (result.kind !== "BLOB") {throw new ContentIOError("INTERNAL");}
        releases.push(result.release);
        checkSignal(signal);
        if (result.blob.size !== file.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
        urls[path] = URL.createObjectURL(result.blob);
      } finally {await reader.close();}
    }
    checkSignal(signal);
    runtimeWindow.EJS_externalFiles = urls;
    signal.addEventListener("abort", abort, {once: true});
    return cleanup;
  } catch (error) {await cleanup(); throw error;}
}
