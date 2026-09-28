import {MessageChannel} from "node:worker_threads";
import {afterEach, expect, it, vi} from "vitest";
import {adapterFixture} from "../../tests/provider-adapter-fixture.js";
import {rpgMvEnvelope} from "../../tests/provider-fixtures.js";
import {rangePolicy} from "../provider/content-policies.js";
import {NativeContentFiles} from "./content-files.js";
import {mountWithNativeContent} from "./content-bridge.js";

afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks();});
async function fixture() {
  const frame = document.createElement("iframe"); document.body.append(frame);
  vi.spyOn(NativeContentFiles.prototype, "load").mockResolvedValue();
  const request = vi.spyOn(NativeContentFiles.prototype, "request").mockResolvedValue({status: 200, bytes: new Uint8Array([1, 2])});
  const close = vi.spyOn(NativeContentFiles.prototype, "close").mockResolvedValue();
  const controller = new AbortController(), adapter = adapterFixture();
  const mounted = await mountWithNativeContent(rpgMvEnvelope(), frame, {
    open: vi.fn(), materialize: vi.fn(), closeFile: vi.fn(), preloaded: true,
    inputPolicy: () => rangePolicy("ASYNC", 1024),
  }, async () => adapter, controller.signal);
  return {frame, request, close, mounted, adapter, controller};
}
it("accepts only the exact frame and origin, bounds access to the file service, and closes on exit", async () => {
  const {frame, request, close, mounted, adapter} = await fixture();
  const pair = new MessageChannel(), replies: unknown[] = [];
  pair.port2.on("message", reply => replies.push(reply));
  const send = (source: Window | null, origin: string) => window.dispatchEvent(new MessageEvent("message", {
    source, origin, data: {type: "RETROM_WEB_CONTENT_CONNECT", v: 1}, ports: [pair.port1 as unknown as MessagePort],
  }));
  send(window, "https://runtime.test"); send(frame.contentWindow, "https://other.test");
  pair.port2.postMessage({id: 1, type: "READ", path: "index.html", offset: 0, length: 2});
  await new Promise(resolve => setTimeout(resolve, 0)); expect(request).not.toHaveBeenCalled();
  send(frame.contentWindow, "https://runtime.test");
  await vi.waitFor(() => expect(replies).toContainEqual({type: "READY", preloaded: true}));
  await vi.waitFor(() => expect(replies).toContainEqual({id: 1, status: 200, bytes: new Uint8Array([1, 2])}));
  await mounted.exit(); expect(adapter.exit).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  send(frame.contentWindow, "https://runtime.test");
  pair.port2.postMessage({id: 2, type: "STAT", path: "other-game"});
  await new Promise(resolve => setTimeout(resolve, 0)); expect(request).toHaveBeenCalledOnce();
  pair.port2.close();
});
it("aborting a mounted frame closes file readers and prevents later connections", async () => {
  const {controller, close} = await fixture(); controller.abort();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});
