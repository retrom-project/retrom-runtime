export type WebMSXCore = {
  canvas: HTMLCanvasElement;
  checkpoint(): Uint8Array;
  pause(): void;
  resume(): void;
  stop(): void;
};
export type WebMSXModule = {
  abi: "webmsx-host-v1";
  create(options: {target: HTMLElement; bytes: Uint8Array; digest: string; restore: Uint8Array | null}): Promise<WebMSXCore>;
};
export type WebMSXLoader = (url: string, realm: Window, signal?: AbortSignal) => Promise<WebMSXModule>;

export const loadWebMSX: WebMSXLoader = (url, realm, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const script = realm.document.createElement("script");
  script.src = url;
  const timeout = realm.setTimeout(() => finish(new Error("WEBMSX_CORE_LOAD_TIMEOUT")), 15000);
  const abort = () => finish(new Error("WEBMSX_LOAD_ABORTED"));
  function finish(error: Error | null) {
    realm.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    script.remove();
    const module = (realm as Window & {__RETROM_WEBMSX_CORE_V1__?: WebMSXModule}).__RETROM_WEBMSX_CORE_V1__;
    if (error) {reject(error);}
    else if (!module || module.abi !== "webmsx-host-v1" || typeof module.create !== "function") {
      reject(new Error("WEBMSX_CORE_ABI_MISMATCH"));
    } else {resolve(module);}
  }
  signal?.addEventListener("abort", abort, {once: true});
  script.onload = () => finish(null);
  script.onerror = () => finish(new Error("WEBMSX_CORE_LOAD_FAILED"));
  realm.document.head.append(script);
});
