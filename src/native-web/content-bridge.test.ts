import {MessageChannel} from "node:worker_threads";
import {afterEach, expect, it, vi} from "vitest";
import {adapterFixture} from "../../tests/provider-adapter-fixture.js";
import {rpgMvEnvelope} from "../../tests/provider-fixtures.js";
import {rangePolicy} from "../provider/content-policies.js";
import {NativeContentFiles} from "./content-files.js";
import {mountWithNativeContent} from "./content-bridge.js";
import type {NativeContentActivity} from "./startup-timeout.js";

afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks();});
async function fixture() {
  const frame = document.createElement("iframe"); document.body.append(frame);
  vi.spyOn(NativeContentFiles.prototype, "load").mockResolvedValue();
  const request = vi.spyOn(NativeContentFiles.prototype, "request").mockResolvedValue({status: 200, bytes: new Uint8Array([1, 2])});
  const close = vi.spyOn(NativeContentFiles.prototype, "close").mockResolvedValue();
  const controller = new AbortController(), adapter = adapterFixture();
  let loading: NativeContentActivity | undefined;
  const mounted = await mountWithNativeContent(rpgMvEnvelope(), frame, {
    open: vi.fn(), materialize: vi.fn(), closeFile: vi.fn(), preloaded: true,
    inputPolicy: () => rangePolicy("ASYNC", 1024),
  }, async activity => {loading = activity; return adapter;}, controller.signal);
  return {frame, request, close, mounted, adapter, controller, loading: loading!};
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
it("counts concurrent reads until the final response and does not count metadata requests", async () => {
  const {frame, request, mounted, loading} = await fixture();
  const changes: boolean[] = [], end = loading.subscribe(busy => changes.push(busy));
  const pending: Array<(value: Record<string, unknown>) => void> = [];
  request.mockImplementation(async value => {
    if ((value as {type: string}).type === "STAT") {return {status: 200};}
    return new Promise(resolve => pending.push(resolve));
  });
  const pair = new MessageChannel(); pair.port2.on("message", () => {});
  try {
    window.dispatchEvent(new MessageEvent("message", {source: frame.contentWindow, origin: "https://runtime.test",
      data: {type: "RETROM_WEB_CONTENT_CONNECT", v: 1}, ports: [pair.port1 as unknown as MessagePort]}));
    pair.port2.postMessage({id: 1, type: "STAT", path: "index.html"});
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(changes).toEqual([false]);
    for (const id of [2, 3]) {pair.port2.postMessage({id, type: "READ", path: "index.html", offset: 0, length: 2});}
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(changes).toEqual([false, true]);
    pending[0]({status: 200}); await new Promise(resolve => setTimeout(resolve, 0));
    expect(changes).toEqual([false, true]);
    pending[1]({status: 200});
    await vi.waitFor(() => expect(changes).toEqual([false, true, false]));
  } finally {end(); pair.port2.close(); await mounted.exit();}
});
it("admits at most four reads so queued plugin requests do not spend their Content I/O deadline", async () => {
  const {frame, request, mounted} = await fixture();
  const pending: Array<(value: Record<string, unknown>) => void> = [];
  request.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const pair = new MessageChannel(), replies: unknown[] = [];
  pair.port2.on("message", reply => replies.push(reply));
  try {
    window.dispatchEvent(new MessageEvent("message", {source: frame.contentWindow, origin: "https://runtime.test",
      data: {type: "RETROM_WEB_CONTENT_CONNECT", v: 1}, ports: [pair.port1 as unknown as MessagePort]}));
    for (let id = 1; id <= 6; id++) {pair.port2.postMessage({id, type: "READ", admission: true, path: "index.html", offset: 0, length: 2});}
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(4));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(pending).toHaveLength(4);
    expect(replies.filter(reply => (reply as {type?: string}).type === "READ_STARTED")).toHaveLength(4);
    pending[0]({status: 200, bytes: new Uint8Array(2)});
    await vi.waitFor(() => expect(pending).toHaveLength(5));
    await mounted.exit();
    for (const finish of pending) {finish({status: 200, bytes: new Uint8Array(2)});}
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pending).toHaveLength(5);
  } finally {pair.port2.close(); await mounted.exit();}
});
