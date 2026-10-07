import {afterEach, expect, it, vi} from "vitest";
import {installContentXHR} from "./content-xhr.js";
import {eagerPolicy} from "../provider/content-policies.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
const source = {identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "RPG_RT.ldb"},
  url: new URL("/game/RPG_RT.ldb", location.href).href, sizeBytes: 3, purpose: "GAME", transport: "WHOLE_ALLOWED",
  etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
function fixture(frame: Window = window) {
  const XHR = (frame as Window & typeof globalThis).XMLHttpRequest;
  const send = vi.spyOn(XHR.prototype, "send").mockImplementation(() => {});
  const nativeOpen = XHR.prototype.open;
  const open = vi.spyOn(XHR.prototype, "open").mockImplementation(function(this: XMLHttpRequest, method, url) {
    return nativeOpen.call(this, method, url, true);
  });
  const close = vi.fn(async () => {}), read = vi.fn(async () => ({id: "reader", close}));
  const materialize = vi.fn(async () => ({kind: "BYTES", bytes: new Uint8Array([1, 2, 3])}));
  const session = {open: read, materialize, closeFile: close} as unknown as AdapterContentSession;
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {static createObjectURL = () => "blob:http://localhost/cached"; static revokeObjectURL = revoke;});
  const controller = new AbortController();
  const cleanup = installContentXHR(frame, new Map([[source.url, {source, policy: eagerPolicy(100, {mode: "ON_OPEN"})}]]), session, controller.signal);
  return {send, open, close, read, materialize, revoke, cleanup, controller};
}
it("downloads only requested indexed entries through Content I/O, preserving upstream XHR events", async () => {
  const f = fixture();
  try {
    expect(f.read).not.toHaveBeenCalled();
    const xhr = new XMLHttpRequest(); xhr.open("GET", source.url); xhr.responseType = "arraybuffer"; xhr.send();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(f.read).toHaveBeenCalledWith(source, expect.objectContaining({mode: "ON_OPEN"}), expect.any(AbortSignal));
    expect(f.open).toHaveBeenLastCalledWith("GET", "blob:http://localhost/cached", true);
    expect(xhr.responseType).toBe("arraybuffer");
    expect(f.close).toHaveBeenCalledOnce();
    xhr.dispatchEvent(new ProgressEvent("loadend"));
    expect(f.revoke).toHaveBeenCalledOnce();
  } finally {f.cleanup();}
});
it("passes through core assets and index metadata without putting them in the game cache", () => {
  const f = fixture();
  try {const xhr = new XMLHttpRequest(); xhr.open("GET", "/core/player.wasm"); xhr.send();
    expect(f.send).toHaveBeenCalledOnce(); expect(f.read).not.toHaveBeenCalled();
  } finally {f.cleanup();}
});
it("aborting a pending cache read cannot start an upstream download afterwards", async () => {
  const f = fixture(); let finish: (value: never) => void = () => {};
  f.materialize.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  try {
    const xhr = new XMLHttpRequest(), aborted = vi.fn(); xhr.addEventListener("abort", aborted);
    xhr.open("GET", source.url); xhr.send(); await vi.waitFor(() => expect(f.materialize).toHaveBeenCalledOnce());
    xhr.abort(); finish({kind: "BYTES", bytes: new Uint8Array(3)} as never);
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce());
    expect(f.send).not.toHaveBeenCalled(); expect(aborted).toHaveBeenCalledOnce();
  } finally {f.cleanup();}
});
it("rejects a corrupt content read instead of retrying the original network URL", async () => {
  const f = fixture(); f.materialize.mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));
  try {
    const xhr = new XMLHttpRequest(), failed = vi.fn(); xhr.addEventListener("error", failed);
    xhr.open("GET", source.url); xhr.send(); await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(f.send).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
  } finally {f.cleanup();}
});

it("resolves root-relative content inside the about:blank runtime frame", async () => {
  const iframe = document.createElement("iframe"); document.body.append(iframe);
  const frame = iframe.contentWindow as Window & typeof globalThis;
  const f = fixture(frame);
  try {
    expect(frame.location.href).toBe("about:blank");
    const xhr = new frame.XMLHttpRequest(); xhr.open("GET", "/game/RPG_RT.ldb"); xhr.send();
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    expect(f.read).toHaveBeenCalledWith(source, expect.any(Object), expect.any(AbortSignal));
  } finally {f.cleanup(); iframe.remove();}
});

it("serves the derived native engine index without fetching an invented host route", async () => {
  const f = fixture(); f.cleanup();
  const url = new URL("/api/v1/runs/run/resources/index/id/index.json", location.href).href;
  const cleanup = installContentXHR(window, new Map([[url, {metadata: new TextEncoder().encode('{"metadata":{"version":2},"cache":{}}')}]]),
    {open: f.read, materialize: f.materialize} as unknown as AdapterContentSession, new AbortController().signal);
  try {
    const xhr = new XMLHttpRequest(); xhr.open("GET", url); xhr.send();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(f.read).not.toHaveBeenCalled();
    expect(f.open).toHaveBeenLastCalledWith("GET", "blob:http://localhost/cached", true);
    xhr.dispatchEvent(new ProgressEvent("loadend")); expect(f.revoke).toHaveBeenCalledOnce();
  } finally {cleanup();}
});
