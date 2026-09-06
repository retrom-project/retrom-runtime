// The pinned 4.3 PSP loader bypasses EJS_paths for its data archive and adds a
// mutable cache buster to its report. Resolve only those requests to bundle assets.
export function installPspAssetCompatibility(runtimeWindow: Window, runtimeBaseUrl: string) {
  const originalFetch = runtimeWindow.fetch;
  const documentUrl = runtimeWindow.document.baseURI;
  const runtimeUrl = new URL(runtimeBaseUrl, documentUrl);
  const hardcodedAssets = new URL("data/cores/ppsspp-assets.zip", documentUrl).href;
  const assets = new URL("cores/ppsspp-assets.zip", runtimeUrl).href;
  const report = new URL("cores/reports/ppsspp.json", runtimeUrl).href;
  const compatible: typeof fetch = (input, init) => {
    const request = typeof input === "string" || input instanceof URL ? null : input;
    const method = init?.method ?? request?.method ?? "GET";
    const url = new URL(request ? request.url : String(input), documentUrl);
    if (method.toUpperCase() !== "GET") {return originalFetch.call(runtimeWindow, input, init);}
    if (url.href === "https://cdn.emulatorjs.org/stable/data/version.json") {
      return Promise.resolve(Response.json({version: "4.3.0-pre", current_version: "4.3.0-pre"}));
    }
    let destination: string | null = null;
    if (url.href === hardcodedAssets) {destination = assets;}
    if (url.origin + url.pathname === report && /^\?v=\d+$/.test(url.search)) {destination = report;}
    const forwarded = destination ? request ? new Request(destination, request) : destination : input;
    return originalFetch.call(runtimeWindow, forwarded, init);
  };
  runtimeWindow.fetch = compatible;
  return () => {if (runtimeWindow.fetch === compatible) {runtimeWindow.fetch = originalFetch;}};
}
