import type {ContentSourceV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import {ContentIOError} from "../content-io/errors.js";

type IndexedContent = {source: ContentSourceV1; policy: ManagedInputPolicyV1};
type Pending = {controller: AbortController; url?: string; sent: boolean; finish(): void};

/** EasyRPG's async wget consumes XHR. Only authorized indexed payload URLs enter Content I/O. */
export function installContentXHR(frame: Window, files: ReadonlyMap<string, IndexedContent>,
  session: AdapterContentSession, signal: AbortSignal): () => void {
  const realm = frame as Window & typeof globalThis, prototype = realm.XMLHttpRequest.prototype;
  const open = prototype.open, send = prototype.send, abort = prototype.abort;
  const selected = new WeakMap<XMLHttpRequest, IndexedContent>(), pending = new Map<XMLHttpRequest, Pending>();
  let closed = false;
  const cancel = (xhr: XMLHttpRequest) => {
    const request = pending.get(xhr);
    if (!request) {return;}
    request.controller.abort(); request.finish();
    if (!request.sent) {
      xhr.dispatchEvent(new realm.ProgressEvent("abort")); xhr.dispatchEvent(new realm.ProgressEvent("loadend"));
    }
  };
  const wrappedOpen: typeof open = function(this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
    cancel(this); selected.delete(this);
    const entry = files.get(new URL(url, globalThis.location.href).href);
    if (entry && method.toUpperCase() === "GET" && async) {selected.set(this, entry);}
    return open.call(this, method, url, async, username, password);
  };
  const wrappedSend: typeof send = function(this: XMLHttpRequest, body) {
    const entry = selected.get(this);
    if (!entry || closed) {return send.call(this, body);}
    if (pending.has(this)) {throw new realm.DOMException("Already sending", "InvalidStateError");}
    start(this, entry);
  };
  const start = (xhr: XMLHttpRequest, entry: IndexedContent) => {
    const controller = new AbortController();
    const request: Pending = {controller, sent: false, finish() {
      xhr.removeEventListener("loadend", request.finish);
      if (request.url) {URL.revokeObjectURL(request.url); request.url = undefined;}
      pending.delete(xhr);
    }};
    pending.set(xhr, request);
    xhr.addEventListener("loadend", request.finish);
    const active = AbortSignal.any([signal, controller.signal]);
    void (async () => {
      const reader = await session.open(entry.source, entry.policy, active);
      try {
        const value = await session.materialize(reader.id, {kind: "BYTES", maxBytes: entry.policy.maxFileBytes}, active,
          progress => {if (!active.aborted) {xhr.dispatchEvent(new realm.ProgressEvent("progress",
            {lengthComputable: true, loaded: progress.readyBytes, total: progress.totalBytes}));}});
        active.throwIfAborted();
        if (value.kind !== "BYTES" || value.bytes.byteLength !== entry.source.sizeBytes) {throw new ContentIOError("LENGTH_MISMATCH");}
        const responseType = xhr.responseType, timeout = xhr.timeout, credentials = xhr.withCredentials;
        request.url = URL.createObjectURL(new Blob([value.bytes as Uint8Array<ArrayBuffer>]));
        open.call(xhr, "GET", request.url, true);
        xhr.responseType = responseType; xhr.timeout = timeout; xhr.withCredentials = credentials;
        request.sent = true; send.call(xhr);
      } finally {await reader.close();}
    })().catch(() => {
      if (active.aborted) {return;}
      xhr.dispatchEvent(new realm.ProgressEvent("error")); xhr.dispatchEvent(new realm.ProgressEvent("loadend"));
    });
  };
  const wrappedAbort: typeof abort = function(this: XMLHttpRequest) {cancel(this); return abort.call(this);};
  prototype.open = wrappedOpen; prototype.send = wrappedSend; prototype.abort = wrappedAbort;
  const cleanup = () => {
    if (closed) {return;} closed = true;
    signal.removeEventListener("abort", cleanup);
    for (const xhr of pending.keys()) {cancel(xhr); abort.call(xhr);}
    if (prototype.open === wrappedOpen) {prototype.open = open;}
    if (prototype.send === wrappedSend) {prototype.send = send;}
    if (prototype.abort === wrappedAbort) {prototype.abort = abort;}
  };
  signal.addEventListener("abort", cleanup, {once: true});
  return cleanup;
}
