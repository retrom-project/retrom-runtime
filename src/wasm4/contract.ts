export type Wasm4AdapterConfig = {
  adapterKind: "WASM4_WEB";
  adapterId: "wasm4-web";
  cartUrl: string;
  runtimeBaseUrl: string;
};

export type Wasm4RuntimeConfig = {
  sessionId: string;
  contentDigest: string;
  cartSizeBytes: number;
  adapter: Wasm4AdapterConfig;
};

export function validateWasm4RuntimeConfig(config: Wasm4RuntimeConfig): void {
  const adapter = config?.adapter;
  if (!config || typeof config !== "object" || !validSessionId(config.sessionId) ||
    !/^[0-9a-f]{64}$/u.test(config.contentDigest) || !Number.isSafeInteger(config.cartSizeBytes) ||
    config.cartSizeBytes < 1 || config.cartSizeBytes > 1 << 16 || adapter?.adapterKind !== "WASM4_WEB" ||
    adapter.adapterId !== "wasm4-web" || !validUrl(adapter.cartUrl) || !validUrl(adapter.runtimeBaseUrl)) {
    throw new Error("WASM4_RUNTIME_CONFIG_INVALID");
  }
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
}

function validUrl(value: string) {
  try {return ["http:", "https:"].includes(new URL(value, globalThis.location?.origin ?? "https://runtime.invalid").protocol);}
  catch {return false;}
}
