import {installPspAssetCompatibility} from "./psp-assets.js";

type EjsCompressionConstructor = {
  prototype?: {getWorkerFile?: (archiveType: string) => Promise<Blob>};
};

type CompressionWindow = Window & {
  Blob: typeof Blob;
  EJS_COMPRESSION?: EjsCompressionConstructor;
  URL: typeof URL;
};

const normalizedReaders = new WeakSet<(...args: never[]) => unknown>();
const rewrites = {
  "7z": {
    dynamicWrapper: "eval(_0x370f8c)",
    globalLookup: 'eval("_"+_0x222174)',
    safeGlobalLookup: 'Module["_"+_0x222174]',
    safeWrapper: "(function(){return function(){return ccall(_0x405d7e,_0x2bdb59,_0x4f818b,Array.prototype.slice.call(arguments))}})()",
  },
  zip: {
    dynamicWrapper: "eval(_0x6f14b3)",
    globalLookup: 'eval("_"+_0x5d9040)',
    safeGlobalLookup: 'Module["_"+_0x5d9040]',
    safeWrapper: "(function(){return function(){return ccall(_0x557d23,_0x36bd20,_0x501373,Array.prototype.slice.call(arguments))}})()",
  },
} as const;

type ArchiveType = keyof typeof rewrites;

export function installArchiveWorkerCompatibility(
  runtimeWindow: Window,
  emulatorJsVersion: string,
  runtimeBaseUrl: string,
  core = "",
) {
  const target = runtimeWindow as CompressionWindow;
  if (emulatorJsVersion === "4.2.3") {return installBlobCompatibility(target);}
  if (emulatorJsVersion === "4.3.0-pre") {
    const archive = installResponseCompatibility(target, runtimeBaseUrl);
    const psp = core === "ppsspp" ? installPspAssetCompatibility(target, runtimeBaseUrl) : null;
    return () => {psp?.(); archive();};
  }
  throw unavailable();
}

function rewriteWorker(source: string, archiveType: ArchiveType) {
  const rewrite = rewrites[archiveType];
  let result = replaceOnce(source, rewrite.globalLookup, rewrite.safeGlobalLookup);
  result = replaceOnce(result, rewrite.dynamicWrapper, rewrite.safeWrapper);
  if (result.includes("eval(")) {throw unavailable();}
  return result;
}

function replaceOnce(source: string, fragment: string, replacement: string) {
  const first = source.indexOf(fragment);
  if (first < 0 || source.indexOf(fragment, first + fragment.length) >= 0) {throw unavailable();}
  return `${source.slice(0, first)}${replacement}${source.slice(first + fragment.length)}`;
}

function installBlobCompatibility(runtimeWindow: CompressionWindow) {
  const previous = Object.getOwnPropertyDescriptor(runtimeWindow, "EJS_COMPRESSION");
  if (previous && !previous.configurable) {
    normalizeReader(runtimeWindow, runtimeWindow.EJS_COMPRESSION);
    return () => undefined;
  }
  let current = runtimeWindow.EJS_COMPRESSION;
  if (current) {normalizeReader(runtimeWindow, current);}
  Object.defineProperty(runtimeWindow, "EJS_COMPRESSION", {
    configurable: true,
    enumerable: previous?.enumerable ?? true,
    get: () => current,
    set: (value: EjsCompressionConstructor | undefined) => {
      normalizeReader(runtimeWindow, value);
      current = value;
    },
  });
  return () => {
    if (current) {
      Object.defineProperty(runtimeWindow, "EJS_COMPRESSION", {
        configurable: true, enumerable: previous?.enumerable ?? true, value: current, writable: true,
      });
    } else if (previous) {Object.defineProperty(runtimeWindow, "EJS_COMPRESSION", previous);}
    else {Reflect.deleteProperty(runtimeWindow, "EJS_COMPRESSION");}
  };
}

function normalizeReader(runtimeWindow: CompressionWindow, constructor: EjsCompressionConstructor | undefined) {
  const prototype = constructor?.prototype;
  const original = prototype?.getWorkerFile;
  if (!prototype || typeof original !== "function") {throw unavailable();}
  if (normalizedReaders.has(original as (...args: never[]) => unknown)) {return;}
  const compatible = async function (this: unknown, archiveType: string) {
    const blob = await original.call(this, archiveType);
    if (archiveType !== "7z" && archiveType !== "zip") {return blob;}
    return new runtimeWindow.Blob([rewriteWorker(await blob.text(), archiveType)], {
      type: blob.type || "application/javascript",
    });
  };
  normalizedReaders.add(compatible as (...args: never[]) => unknown);
  prototype.getWorkerFile = compatible;
}

function installResponseCompatibility(runtimeWindow: CompressionWindow, runtimeBaseUrl: string) {
  const originalFetch = runtimeWindow.fetch;
  if (typeof originalFetch !== "function") {throw unavailable();}
  const baseURL = httpBase(runtimeWindow);
  const runtimeURL = new runtimeWindow.URL(runtimeBaseUrl, baseURL);
  const workerURLs = new Map<string, ArchiveType>([
    [new runtimeWindow.URL("compression/extract7z.js", runtimeURL).href, "7z"],
    [new runtimeWindow.URL("compression/extractzip.js", runtimeURL).href, "zip"],
  ]);
  const compatibleFetch: typeof fetch = async (input, init) => {
    const requestURL = requestUrl(runtimeWindow, input, baseURL);
    const archiveType = workerURLs.get(requestURL.href);
    const response = await originalFetch.call(runtimeWindow, input, init);
    const method = init?.method ?? (typeof input === "string" || input instanceof URL ? "GET" : input.method);
    if (!archiveType || method.toUpperCase() !== "GET" || !response.ok) {return response;}
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("etag");
    return new Response(rewriteWorker(await response.text(), archiveType), {
      headers, status: response.status, statusText: response.statusText,
    });
  };
  runtimeWindow.fetch = compatibleFetch;
  return () => {if (runtimeWindow.fetch === compatibleFetch) {runtimeWindow.fetch = originalFetch;}};
}

function httpBase(runtimeWindow: Window) {
  if (runtimeWindow.location.protocol === "http:" || runtimeWindow.location.protocol === "https:") {
    return runtimeWindow.location.href;
  }
  const parentLocation = runtimeWindow.parent.location;
  if (parentLocation.protocol === "http:" || parentLocation.protocol === "https:") {return parentLocation.href;}
  throw unavailable();
}

function requestUrl(runtimeWindow: CompressionWindow, input: RequestInfo | URL, baseURL: string) {
  const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new runtimeWindow.URL(value, baseURL);
}

function unavailable() {return new Error("PLAYER_ARCHIVE_COMPATIBILITY_UNAVAILABLE");}
