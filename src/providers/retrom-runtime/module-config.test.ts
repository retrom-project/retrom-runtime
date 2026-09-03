import { describe, expect, it } from "vitest";

import { projectLegacyRuntimeConfig } from "./module-config.js";
import { retromRuntimeProviderDefinition } from "./catalog.js";
import type { LaunchEnvelopeV1, RuntimeResourceV1 } from "../../provider/module-api.js";
import { projectProviderManifest } from "../../provider/manifest.js";

const digest = "a".repeat(64);
const otherDigest = "b".repeat(64);
const sessionId = "018f0f31-26fe-7a31-9d61-4ec92f16d4c3";
const assetIndex = {
  "assets/mkxp/mkxp-z_libretro.js": {sha256: digest, sizeBytes: 1000},
  "assets/mkxp/mkxp-z_libretro.wasm": {sha256: otherDigest, sizeBytes: 2000},
};

describe("retrom-runtime Provider config projection", () => {
  it.each([
    ["rpgmaker-2000", "EASYRPG_WEB", "rpg2k"],
    ["rpgmaker-2003", "EASYRPG_WEB", "rpg2k3"],
    ["rpgmaker-xp", "MKXP_LIBRETRO_WEB", 1],
    ["rpgmaker-vx", "MKXP_LIBRETRO_WEB", 2],
    ["rpgmaker-vx-ace", "MKXP_LIBRETRO_WEB", 3],
    ["rpgmaker-mv", "NATIVE_WEB", "RPGMV"],
    ["rpgmaker-mz", "NATIVE_WEB", "RPGMZ"],
  ])("maps RPG target %s without Host adapter fields", (targetId, adapterKind, mode) => {
    const envelope = rpgEnvelope(targetId);
    expect(JSON.stringify(envelope)).not.toMatch(/adapter|engineMode|rgssVersion|bridgeProfile/u);
    const config = projectLegacyRuntimeConfig(envelope, assetIndex);
    expect(config.adapter.adapterKind).toBe(adapterKind);
    if (config.adapter.adapterKind === "EASYRPG_WEB") {expect(config.adapter.engineMode).toBe(mode);}
    if (config.adapter.adapterKind === "MKXP_LIBRETRO_WEB") {
      expect(config.adapter).toMatchObject({
        core: {
          artifactSetSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          jsSha256: digest,
          jsSizeBytes: 1000,
          jsUrl: `/runtime/providers/retrom-runtime/${otherDigest}/assets/mkxp/mkxp-z_libretro.js`,
          wasmSha256: otherDigest,
          wasmSizeBytes: 2000,
          wasmUrl: `/runtime/providers/retrom-runtime/${otherDigest}/assets/mkxp/mkxp-z_libretro.wasm`,
        },
        rgssVersion: mode,
        stateBufferBytes: 268435456,
      });
    }
    if (config.adapter.adapterKind === "NATIVE_WEB") {expect(config.adapter.bridgeProfile).toBe(mode);}
  });

  it("preserves standalone project adapter options", () => {
    expect(projectLegacyRuntimeConfig(
      envelope("onscripter-yuri", fileTree(), {kind: "ONS_PROJECT_V1", scriptEncoding: "sjis"}), assetIndex,
    )).toMatchObject({
      adapter: {
        adapterId: "ons-yuri-web",
        adapterKind: "ONS_YURI_WEB",
        checkpointSlot: 999,
        projectIndexUrl: `/runtime/content/project/${digest}/index.json`,
        scriptEncoding: "sjis",
      },
    });
    expect(projectLegacyRuntimeConfig(
      envelope("kirikiri2-kag", fileTree(), {kind: "KIRIKIRI_PROJECT_V1", startupXp3Path: "data.xp3"}),
      assetIndex,
    )).toMatchObject({
      adapter: {
        adapterId: "kirikiri2-web",
        adapterKind: "KIRIKIRI2_WEB",
        checkpointSlot: 1999,
        startupXp3Path: "data.xp3",
      },
    });
    expect(projectLegacyRuntimeConfig(
      envelope("butterscotch-gamemaker", fileTree(), {kind: "NONE_V1"}), assetIndex,
    )).toMatchObject({
      adapter: {adapterId: "butterscotch-web", adapterKind: "BUTTERSCOTCH_WEB"},
      contentDigest: digest,
    });
  });

  it("preserves isolated Web and WASM-4 resource boundaries", () => {
    const isolated: RuntimeResourceV1 = {
      bootstrapTicket: "t".repeat(48),
      cleanupUrl: "https://runtime.example/__retrom/cleanup",
      contentDigest: digest,
      entryUrl: "https://runtime.example/__retrom/bootstrap",
      kind: "ISOLATED_WEB_V1",
      ordinal: 0,
      origin: "https://runtime.example",
      role: "game",
    };
    expect(projectLegacyRuntimeConfig(
      envelope("tyranoscript", isolated, {kind: "NONE_V1"}), assetIndex,
    )).toMatchObject({
      adapter: {
        adapterId: "tyranoscript-web",
        adapterKind: "TYRANOSCRIPT_WEB",
        bootstrapTicket: "t".repeat(48),
        cleanupUrl: "https://runtime.example/__retrom/cleanup",
        entryUrl: "https://runtime.example/__retrom/bootstrap",
        uniqueOrigin: "https://runtime.example",
      },
      contentDigest: digest,
    });

    const cart: RuntimeResourceV1 = {
      kind: "WASM4_CART_V1",
      ordinal: 0,
      rangeRequired: false,
      role: "game",
      sha256: digest,
      sizeBytes: 65536,
      url: "/runtime/content/game/cart.wasm",
    };
    expect(projectLegacyRuntimeConfig(envelope("wasm4", cart, {kind: "NONE_V1"}), assetIndex)).toEqual({
      adapter: {
        adapterId: "wasm4-web",
        adapterKind: "WASM4_WEB",
        cartUrl: "/runtime/content/game/cart.wasm",
        runtimeBaseUrl: `/runtime/providers/retrom-runtime/${otherDigest}/assets/wasm4/`,
      },
      cartSizeBytes: 65536,
      contentDigest: digest,
      sessionId,
    });
  });

  it("rejects a resource or target contract mismatch", () => {
    const wrong = envelope("wasm4", fileTree(), {kind: "NONE_V1"});
    expect(() => projectLegacyRuntimeConfig(wrong, assetIndex)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    const unknown = structuredClone(wrong);
    unknown.runtime.targetId = "unknown";
    expect(() => projectLegacyRuntimeConfig(unknown, assetIndex)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });
});

function rpgEnvelope(targetId: string) {
  const resource = targetId.startsWith("rpgmaker-xp") || targetId.startsWith("rpgmaker-vx")
    ? seekable()
    : targetId === "rpgmaker-mv" || targetId === "rpgmaker-mz"
      ? nativeWeb()
      : fileTree();
  return envelope(targetId, resource, {kind: "RPGMAKER_V1", expectedRestorePosition: null});
}

function envelope(
  targetId: string,
  resource: RuntimeResourceV1,
  targetOptions: LaunchEnvelopeV1["targetOptions"],
): LaunchEnvelopeV1 {
  const target = retromRuntimeProviderDefinition.targets.find((entry) => entry.id === targetId);
  const manifestTarget = projectProviderManifest(retromRuntimeProviderDefinition).targets.find(
    (entry) => entry.id === targetId,
  );
  if (!target || !manifestTarget) {throw new Error(`unknown test target ${targetId}`);}
  return {
    netplay: null,
    resources: [resource],
    restore: null,
    runtime: {
      bundleSha256: otherDigest,
      capabilities: manifestTarget.capabilities,
      checkpoint: manifestTarget.checkpoint === null ? null : {
        maxBytes: manifestTarget.checkpoint.maxBytes,
        readFormats: [...manifestTarget.checkpoint.readFormats],
        writeFormat: manifestTarget.checkpoint.writeFormat,
      },
      gameCompatibilityLine: target.gameCompatibilityLine,
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${otherDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.13.0",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${otherDigest}/`,
      targetContractSha256: digest,
      targetId,
    },
    schemaVersion: 1,
    session: {
      coreName: "Fixture Core",
      id: sessionId,
      mode: "SINGLE",
      platformName: "Fixture",
      purpose: "PRODUCT",
      returnTo: "/games/fixture",
      title: "Fixture",
      warnings: [],
    },
    targetOptions,
    validation: null,
  };
}

function fileTree(): RuntimeResourceV1 {
  return {
    contentDigest: digest,
    indexUrl: `/runtime/content/project/${digest}/index.json`,
    kind: "FILE_TREE_V1",
    ordinal: 0,
    role: "game",
  };
}

function seekable(): RuntimeResourceV1 {
  return {
    kind: "SEEKABLE_BLOB_V1",
    ordinal: 0,
    rangeRequired: true,
    role: "game",
    sha256: digest,
    sizeBytes: 4096,
    url: `/runtime/content/project/${digest}/game.mkxpz`,
  };
}

function nativeWeb(): RuntimeResourceV1 {
  return {
    bootstrapTicket: "t".repeat(48),
    cleanupUrl: "https://runtime.example/__retrom/cleanup",
    contentDigest: digest,
    entryUrl: "https://runtime.example/__retrom/bootstrap",
    kind: "NATIVE_WEB_V1",
    ordinal: 0,
    origin: "https://runtime.example",
    role: "game",
  };
}
