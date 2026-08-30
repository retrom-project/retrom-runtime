import { describe, expect, it } from "vitest";

import { validateTyranoScriptRuntimeConfig, type TyranoScriptRuntimeConfig } from "./contract.js";

describe("TyranoScript runtime config", () => {
  it("accepts an isolated entry and cleanup URL from the declared runtime origin", () => {
    expect(() => validateTyranoScriptRuntimeConfig(config())).not.toThrow();
  });

  it("rejects cross-origin entries, credentials, missing tickets and extra protocols", () => {
    const invalid = [
      {...config(), adapter: {...config().adapter, entryUrl: "https://other.example/runtime/entry"}},
      {...config(), adapter: {...config().adapter, uniqueOrigin: "https://user@runtime.example"}},
      {...config(), adapter: {...config().adapter, bootstrapTicket: ""}},
      {...config(), adapter: {...config().adapter, cleanupUrl: "data:text/plain,cleanup"}},
    ];
    for (const value of invalid) {
      expect(() => validateTyranoScriptRuntimeConfig(value)).toThrowError("TYRANOSCRIPT_RUNTIME_CONFIG_INVALID");
    }
  });
});

function config(): TyranoScriptRuntimeConfig {
  return {
    adapter: {
      adapterId: "tyranoscript-web",
      adapterKind: "TYRANOSCRIPT_WEB",
      bootstrapTicket: "one-time-ticket",
      cleanupUrl: "https://runtime.example/runtime/cleanup",
      entryUrl: "https://runtime.example/runtime/entry",
      uniqueOrigin: "https://runtime.example",
    },
    contentDigest: "a".repeat(64),
    sessionId: "01990000-0000-7000-8000-000000000001",
  };
}
