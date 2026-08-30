export type ButterscotchAdapterConfig = {
  adapterKind: "BUTTERSCOTCH_WEB";
  adapterId: "butterscotch-web";
  projectIndexUrl: string;
  runtimeBaseUrl: string;
};

export type ButterscotchRuntimeConfig = {
  sessionId: string;
  contentDigest: string;
  adapter: ButterscotchAdapterConfig;
};

export function validateButterscotchRuntimeConfig(config: ButterscotchRuntimeConfig): void {
  const adapter = config?.adapter;
  if (!config || typeof config !== "object" || !validSessionId(config.sessionId) ||
    !/^[0-9a-f]{64}$/u.test(config.contentDigest) || adapter?.adapterKind !== "BUTTERSCOTCH_WEB" ||
    adapter.adapterId !== "butterscotch-web" || !validUrl(adapter.projectIndexUrl) ||
    !validUrl(adapter.runtimeBaseUrl)) {
    throw new Error("BUTTERSCOTCH_RUNTIME_CONFIG_INVALID");
  }
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
}

function validUrl(value: string) {
  try {return ["http:", "https:"].includes(new URL(value, globalThis.location?.origin ?? "https://runtime.invalid").protocol);}
  catch {return false;}
}
