export type TyranoScriptAdapterConfig = {
  adapterKind: "TYRANOSCRIPT_WEB";
  adapterId: "tyranoscript-web";
  bootstrapTicket: string;
  cleanupUrl: string | null;
  entryUrl: string;
  uniqueOrigin: string;
};

export type TyranoScriptRuntimeConfig = {
  adapter: TyranoScriptAdapterConfig;
  contentDigest: string;
  sessionId: string;
};

export function validateTyranoScriptRuntimeConfig(config: TyranoScriptRuntimeConfig): void {
  const adapter = config?.adapter;
  if (!config || typeof config !== "object" || !boundedText(config.sessionId, 200) ||
    !/^[0-9a-f]{64}$/u.test(config.contentDigest) || adapter?.adapterKind !== "TYRANOSCRIPT_WEB" ||
    adapter.adapterId !== "tyranoscript-web" || !boundedText(adapter.bootstrapTicket, 1024) ||
    !validOrigin(adapter.uniqueOrigin) || !sameOriginUrl(adapter.entryUrl, adapter.uniqueOrigin) ||
    adapter.cleanupUrl !== null && !sameOriginUrl(adapter.cleanupUrl, adapter.uniqueOrigin)) {
    throw new Error("TYRANOSCRIPT_RUNTIME_CONFIG_INVALID");
  }
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== "string") {return false;}
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value && url.username === "" && url.password === "";
  } catch {return false;}
}

function sameOriginUrl(value: unknown, origin: string) {
  if (typeof value !== "string") {return false;}
  try {
    const url = new URL(value);
    return url.origin === origin && ["http:", "https:"].includes(url.protocol) && url.username === "" && url.password === "";
  } catch {return false;}
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
