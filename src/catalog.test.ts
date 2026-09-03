import { describe, expect, it } from "vitest";

import {runtimeAdapters, validateRuntimeConfig} from "./catalog.js";
import { validateOnsRuntimeConfig } from "./ons/contract.js";
import type { RpgMakerRuntimeConfig } from "./rpgmaker/contract.js";
import {retromRuntimeProviderDefinition} from "./providers/retrom-runtime/catalog.js";

describe("runtime catalog", () => {
  it("covers all seven supported RPG Maker targets", () => {
    expect(retromRuntimeProviderDefinition.targets.filter((target) => target.id.startsWith("rpgmaker-"))
      .map((target) => target.id)).toEqual([
      "rpgmaker-2000", "rpgmaker-2003", "rpgmaker-mv", "rpgmaker-mz", "rpgmaker-vx",
      "rpgmaker-vx-ace", "rpgmaker-xp",
    ]);
  });

  it("derives every legacy execution descriptor from the Provider declaration", () => {
    expect(runtimeAdapters.map((adapter) => [adapter.adapterId, adapter.adapterKind, adapter.adapterAbi]))
      .toEqual(retromRuntimeProviderDefinition.adapters.map((adapter) => [adapter.id, adapter.kind, adapter.abi]));
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
    expect(retromRuntimeProviderDefinition.targets.filter((target) => target.id.startsWith("rpgmaker-"))
      .map((target) => target.id)).not.toContain("onscripter-yuri");
    expect(runtimeAdapters.map((entry) => entry.adapterKind)).toContain("ONS_YURI_WEB");
  });

  it("accepts the standalone Butterscotch adapter without RPG-specific fields", () => {
    expect(() => validateRuntimeConfig({
      sessionId: "runtime-session",
      contentDigest: "d".repeat(64),
      adapter: {
        adapterKind: "BUTTERSCOTCH_WEB",
        adapterId: "butterscotch-web",
        projectIndexUrl: "https://content.example/butterscotch/index.json",
        runtimeBaseUrl: "https://runtime.example/butterscotch/",
      },
    })).not.toThrow();
    expect(retromRuntimeProviderDefinition.targets.filter((target) => target.id.startsWith("rpgmaker-"))
      .map((target) => target.id)).not.toContain("butterscotch-gamemaker");
  });
});

function easyConfig(): RpgMakerRuntimeConfig {
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
      rtpSource: null,
      checkpointSlot: 100,
    },
  };
}
