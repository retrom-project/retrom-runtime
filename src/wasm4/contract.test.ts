import { describe, expect, it } from "vitest";

import { validateWasm4RuntimeConfig, type Wasm4RuntimeConfig } from "./contract.js";

describe("WASM-4 runtime contract", () => {
  it("accepts one content-addressed cart and explicit core base URL", () => {
    expect(() => validateWasm4RuntimeConfig(config())).not.toThrow();
  });

  it("rejects carts outside the WASM-4 size boundary and ambiguous URLs", () => {
    const tooLarge = config();
    tooLarge.cartSizeBytes = 65537;
    expect(() => validateWasm4RuntimeConfig(tooLarge)).toThrow("WASM4_RUNTIME_CONFIG_INVALID");

    const ambiguous = config();
    ambiguous.adapter.cartUrl = "javascript:alert(1)";
    expect(() => validateWasm4RuntimeConfig(ambiguous)).toThrow("WASM4_RUNTIME_CONFIG_INVALID");
  });
});

function config(): Wasm4RuntimeConfig {
  return {
    sessionId: "wasm4-session",
    contentDigest: "a".repeat(64),
    cartSizeBytes: 1024,
    adapter: {
      adapterKind: "WASM4_WEB",
      adapterId: "wasm4-web",
      cartUrl: "https://content.example/cart.wasm",
      runtimeBaseUrl: "https://runtime.example/wasm4/",
    },
  };
}
