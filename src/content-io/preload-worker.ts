import {ContentPreloader} from "./preload.js";
import {record, validateSource} from "./source.js";
import {toContentIOError} from "./errors.js";

/** Provider-private preparation protocol. The versioned core Reader bridge is unchanged. */
export function startContentPreload(value: unknown, scope: {postMessage(value: unknown): void; close(): void}): void {
  if (!record(value) || value.type !== "PRELOAD" || !Array.isArray(value.sources) || value.sources.length > 100_000 ||
    typeof value.storageOrigin !== "string" || value.storageOrigin !== globalThis.location.origin ||
    !Array.isArray(value.allowedOrigins) || !value.allowedOrigins.every(origin => typeof origin === "string")) {
    throw new Error("CONTENT_PRELOAD_INVALID");
  }
  const context = {storageOrigin: value.storageOrigin, allowedOrigins: value.allowedOrigins as string[]};
  const sources = value.sources.map(source => validateSource(source, context));
  const loader = new ContentPreloader(context);
  void loader.prepare(sources, (loadedBytes, totalBytes) => scope.postMessage({type: "PROGRESS", loadedBytes, totalBytes}))
    .then(() => scope.postMessage({type: "COMPLETE"}), error => {
      loader.close();
      scope.postMessage({type: "ERROR", code: toContentIOError(error).code});
      scope.close();
    });
}
