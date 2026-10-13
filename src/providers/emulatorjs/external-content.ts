import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {fileContentSource, requireContentSession, type AdapterContentSession} from "../../provider/content-inputs.js";
import {checkSignal} from "../../content-io/abort.js";
import {ContentIOError} from "../../content-io/errors.js";
import {installExternalFileCompatibility} from "./external-files.js";
import {optionalResource} from "./resources.js";
import type {EjsWindow} from "./emulator-instance.js";

/** Mount verified original files through one pre-start hook in both pinned releases. */
export async function prepareExternalContent(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  optionalSession: AdapterContentSession | null, signal: AbortSignal,
  report: (ready: number, total: number) => void = () => {}): Promise<() => Promise<void>> {
  const files = [
    ...(runtimeWindow.RETROM_FLYCAST_RANGE ? [] : optionalResource(envelope, "game-files", "EXTERNAL_FILE_SET")?.files ?? []).map(file =>
      ({file, path: file.virtualPath, role: "game-files", purpose: "GAME" as const})),
    ...(optionalResource(envelope, "parent", "EXTERNAL_FILE_SET")?.files ?? []).map(file =>
      ({file, path: file.virtualPath, role: "parent", purpose: "GAME" as const})),
    ...(optionalResource(envelope, "external", "EXTERNAL_FILE_SET")?.files ?? []).map(file =>
      ({file, path: `/${file.virtualPath}`, role: "external", purpose: "FIRMWARE" as const})),

  ];
  if (!files.length) {return async () => {};}
  const session = requireContentSession(optionalSession), blobs = new Map<string, Blob>();
  let restore: (() => void) | undefined;
  const releases: Array<() => Promise<void>> = [];
  let closed = false;
  const cleanup = async () => {
    if (closed) {return;} closed = true;
    signal.removeEventListener("abort", abort);
    restore?.(); blobs.clear();
    await Promise.all(releases.map(release => release()));
  };
  const abort = () => {void cleanup().catch(() => {});};
  try {
    for (const {file, path, role, purpose} of files) {
      const normalized = `/${path.replace(/^\//u, "")}`;
      if (blobs.has(normalized)) {throw new Error("PLAYER_EXTERNAL_FILE_CONFLICT");}
      const policy = session.inputPolicy(role);
      const reader = await session.open(fileContentSource(file, policy, purpose), policy, signal);
      try {
        const result = await session.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, signal,
          progress => report(progress.readyBytes, progress.totalBytes));
        if (result.kind !== "BLOB") {throw new ContentIOError("INTERNAL");}
        releases.push(result.release);
        checkSignal(signal);
        if (result.blob.size !== file.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
        blobs.set(normalized, result.blob);
      } finally {await reader.close();}
    }
    checkSignal(signal);
    restore = installExternalFileCompatibility(runtimeWindow, async write => {
      checkSignal(signal);
      if (closed) {throw new Error("PLAYER_EXTERNAL_FILES_CLOSED");}
      for (const [path, blob] of blobs) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        checkSignal(signal);
        if (closed) {throw new Error("PLAYER_EXTERNAL_FILES_CLOSED");}
        write(path, bytes);
      }
    });
    signal.addEventListener("abort", abort, {once: true});
    return cleanup;
  } catch (error) {await cleanup(); throw error;}
}
