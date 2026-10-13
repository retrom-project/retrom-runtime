import {checkSignal} from "../content-io/abort.js";
import type {AdapterContentOptions} from "./content-inputs.js";
import {loadCoreAsset} from "./core-assets.js";

/** Native loaders with lazy fetches keep their URLs and resolve only declared Provider assets through Content I/O. */
export function installCoreAssetFetch(win: Window, content: AdapterContentOptions, runtimeBaseURL: string, signal?: AbortSignal) {
  const original = win.fetch;
  const base = new URL(runtimeBaseURL, location.href);
  const paths = new Map(Object.keys(content.assetIndex).map(path => [new URL(path, base).href, path]));
  const cached: typeof fetch = async (input, init) => {
    const request = typeof input === "string" || input instanceof URL ? null : input;
    const url = new URL(request?.url ?? String(input), win.document.baseURI);
    const path = paths.get(url.href);
    if (!path || !fullGet(request, init)) {
      return original.call(win, input, init);
    }
    const signals = [signal, init?.signal, request?.signal].filter((value): value is AbortSignal => Boolean(value));
    const active = signals.length ? AbortSignal.any(signals) : undefined;
    checkSignal(active);
    const bytes = await loadCoreAsset(content, url.href, path, 256 * 1024 * 1024, active);
    checkSignal(active);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {headers: {"Content-Type": assetMimeType(path), "Content-Length": String(bytes.byteLength)}});
  };
  win.fetch = cached;
  return () => {if (win.fetch === cached) {win.fetch = original;}};
}

function fullGet(request: Request | null, init?: RequestInit) {
  return (init?.method ?? request?.method ?? "GET").toUpperCase() === "GET" &&
    !new Headers(init?.headers ?? request?.headers).has("Range");
}

export function assetMimeType(path: string) {
  if (path.endsWith(".wasm")) {return "application/wasm";}
  if (/\.m?js$/u.test(path)) {return "text/javascript";}
  return path.endsWith(".json") ? "application/json" : "application/octet-stream";
}
