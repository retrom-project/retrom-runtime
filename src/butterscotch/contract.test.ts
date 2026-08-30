import { describe, expect, it } from "vitest";

import { validateButterscotchRuntimeConfig } from "./contract.js";

describe("Butterscotch runtime contract", () => {
  it("accepts a fixed project identity and host-independent Web adapter", () => {
    expect(() => validateButterscotchRuntimeConfig(config())).not.toThrow();
  });

  it("rejects an unversioned project cache identity", () => {
    const value = config();
    value.contentDigest = "mutable-project";
    expect(() => validateButterscotchRuntimeConfig(value)).toThrow("BUTTERSCOTCH_RUNTIME_CONFIG_INVALID");
  });
});

function config() {
  return {
    sessionId: "runtime-session",
    contentDigest: "a".repeat(64),
    adapter: {
      adapterKind: "BUTTERSCOTCH_WEB" as const,
      adapterId: "butterscotch-web" as const,
      projectIndexUrl: "https://content.example/game/index.json",
      runtimeBaseUrl: "https://runtime.example/butterscotch/",
    },
  };
}
