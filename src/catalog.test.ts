import { describe, expect, it } from "vitest";

import { runtimeCatalog, validateRuntimeConfig } from "./catalog.js";
import type { RpgRuntimeConfig } from "./contract.js";
import { validateOnsRuntimeConfig } from "./ons/contract.js";

describe("runtime catalog", () => {
  it("covers all seven supported RPG Maker generations", () => {
    const generations = new Set(runtimeCatalog.flatMap((entry) => entry.generations));
    expect([...generations].sort()).toEqual([
      "RPG2000", "RPG2003", "RPGMV", "RPGMZ", "RPGVX", "RPGVXACE", "RPGXP",
    ]);
  });

  it("accepts a host-independent EasyRPG session", () => {
    expect(() => validateRuntimeConfig(easyConfig())).not.toThrow();
  });

  it("rejects mismatched generation and engine mode", () => {
    const config = easyConfig();
    config.generation = "RPG2003";
    expect(() => validateRuntimeConfig(config)).toThrow("RPG_RUNTIME_CONFIG_INVALID");
  });

  it("accepts the standalone ONS adapter without treating it as an RPG Maker generation", () => {
    expect(() => validateOnsRuntimeConfig({
      sessionId: "runtime-session",
      adapter: {
        adapterKind: "ONS_YURI_WEB",
        adapterId: "ons-yuri-web",
        checkpointSlot: 999,
        projectIndexUrl: "https://content.example/ons/index.json",
        runtimeBaseUrl: "https://runtime.example/ons/",
        scriptEncoding: "gbk",
      },
    })).not.toThrow();
    expect(runtimeCatalog.flatMap((entry) => entry.generations)).not.toContain("ONS");
  });
});

function easyConfig(): RpgRuntimeConfig {
  return {
    sessionId: "runtime-session",
    generation: "RPG2000",
    validationPurpose: false,
    expectedRestorePosition: null,
    adapter: {
      adapterKind: "EASYRPG_WEB",
      adapterId: "easyrpg-web",
      engineMode: "rpg2k",
      runtimeBaseUrl: "https://runtime.example/easyrpg/",
      projectRootUrl: "https://runtime.example/project/",
      projectIndexUrl: "https://runtime.example/project/index.json",
      rtpArchive: null,
      checkpointSlot: 100,
    },
  };
}
