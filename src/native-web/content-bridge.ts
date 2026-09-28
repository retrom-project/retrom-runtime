import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {LaunchEnvelopeV1} from "../provider/module-api.js";
import {integer, record} from "../content-io/source.js";
import {NativeContentFiles} from "./content-files.js";

/** The frame receives only reads from the current immutable game, never the cache or its transport credentials. */
export async function mountWithNativeContent(envelope: LaunchEnvelopeV1, frame: HTMLIFrameElement,
  session: AdapterContentSession, mount: () => Promise<MountedRuntimeAdapter>, signal?: AbortSignal,
  reportFailure: (error: Error) => void = () => {}) {
  const resource = envelope.resources.find(item => item.role === "game" && (item.kind === "NATIVE_WEB" || item.kind === "ISOLATED_WEB"));
  if (!resource || !("origin" in resource)) {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
  const files = new NativeContentFiles(session, session.inputPolicy("game"), signal);
  const ports = new Set<MessagePort>();
  let closed = false;
  const receive = (event: MessageEvent) => {
    if (closed || event.source !== frame.contentWindow || event.origin !== resource.origin ||
      !record(event.data) || event.data.v !== 1) {return;}
    if (event.data.type === "RETROM_WEB_CONTENT_WAITING") {
      frame.contentWindow?.postMessage({type: "RETROM_WEB_CONTENT_START", v: 1}, resource.origin); return;
    }
    if (event.data.type === "RETROM_WEB_CONTENT_FAILED") {
      reportFailure(new Error("CONTENT_IO_STORAGE_UNAVAILABLE")); return;
    }
    if (event.data.type !== "RETROM_WEB_CONTENT_CONNECT" || event.ports.length !== 1) {return;}
    const port = event.ports[0];
    for (const previous of ports) {previous.close();} ports.clear();
    ports.add(port);
    let active = 0;
    port.onmessage = ({data}: MessageEvent<unknown>) => {
      if (closed || !record(data) || !integer(data.id, 1) || active >= 256) {return;}
      active++;
      void files.request(data).then(reply => {
        if (closed) {return;}
        const bytes = reply.bytes;
        port.postMessage({id: data.id, ...reply}, bytes instanceof Uint8Array ? [bytes.buffer] : []);
      }).catch(error => {
        if (!closed) {
          port.postMessage({id: data.id, status: 502});
          reportFailure(error instanceof Error ? error : new Error("CONTENT_IO_READ_FAILED"));
        }
      }).finally(() => {active--;});
    };
    port.start(); port.postMessage({type: "READY", preloaded: session.preloaded === true});
  };
  const close = async () => {
    closed = true; window.removeEventListener("message", receive);
    signal?.removeEventListener("abort", abort);
    for (const port of ports) {port.close();} ports.clear();
    await files.close();
  };
  const abort = () => {void close();};
  try {
    await files.load(resource);
    if (signal?.aborted) {throw new DOMException("Aborted", "AbortError");}
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, {once: true});
    const adapter = await mount();
    return {...adapter, exit: async () => {try {await adapter.exit();} finally {await close();}}};
  } catch (error) {await close(); throw error;}
}
