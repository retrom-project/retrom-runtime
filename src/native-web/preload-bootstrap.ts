import type {LaunchEnvelopeV1} from "../provider/module-api.js";
import {record} from "../content-io/source.js";

/** Authenticate while the ticket is fresh; the host bootstrap waits without executing game code. */
export async function authorizeNativePreload(envelope: LaunchEnvelopeV1, frame: HTMLIFrameElement | undefined,
  signal: AbortSignal): Promise<void> {
  const resource = envelope.resources.find(item => item.role === "game" && (item.kind === "NATIVE_WEB" || item.kind === "ISOLATED_WEB"));
  if (!resource || !("bootstrapTicket" in resource)) {return;}
  const realm = frame?.contentWindow;
  if (!frame || !realm) {throw new Error("PROVIDER_HOST_INVALID");}
  const origin = resource.origin, runtimeWindow: Window = realm;
  if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
  await new Promise<void>((resolve, reject) => {
    let ticket = resource.bootstrapTicket;
    const timer = setTimeout(() => finish(new Error("CONTENT_IO_TIMEOUT")), 15000);
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    function finish(error?: Error) {
      clearTimeout(timer); ticket = "";
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      if (error) {reject(error);} else {resolve();}
    }
    function receive(event: MessageEvent) {
      if (event.source !== runtimeWindow || event.origin !== origin || !record(event.data)) {return;}
      if (event.data.type === "RETROM_WEB_CONTENT_WAITING" && event.data.v === 1) {finish(); return;}
      if (event.data.protocolVersion !== 1) {return;}
      const type = bootstrapReply(event.data.type);
      if (type && ticket) {runtimeWindow.postMessage({type, protocolVersion: 1, ticket}, origin); ticket = "";}
    }
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, {once: true});
    frame.src = resource.entryUrl;
  });
}
function bootstrapReply(type: unknown) {
  if (type === "RPG_RUNTIME_NATIVE_BOOTSTRAP_READY") {return "RPG_RUNTIME_NATIVE_BOOTSTRAP";}
  if (type === "GAME_RUNTIME_TYRANOSCRIPT_BOOTSTRAP_REQUIRED") {return "GAME_RUNTIME_TYRANOSCRIPT_BOOTSTRAP";}
  return null;
}
