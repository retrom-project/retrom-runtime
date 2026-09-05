import type {LaunchEnvelopeV1} from "../src/provider/module-api.js";
import {projectProviderManifest} from "../src/provider/manifest.js";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);

export function wasmEnvelope(): LaunchEnvelopeV1 {
  return {
    netplay: null,
    resources: [{
      kind: "WASM4_CART" as const,
      ordinal: 0,
      rangeRequired: false,
      role: "game",
      sha256: digest,
      sizeBytes: 128,
      url: "/runtime/content/game/cart.wasm",
    }],
    restore: {format: "wasm4-state-v1", sha256: digest, sizeBytes: 3, url: "/runtime/launches/id/state"},
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: {
        checkpoint: true,
        discSwitch: false,
        frameCounter: true,
        frameMode: "SAME_ORIGIN_BLANK" as const,
        inputFilter: true,
        nativeSettings: false,
        netplayPort: false,
        pause: true,
        requiresThreads: false,
        screenshot: true,
        standardGamepad: true,
        videoModes: ["original", "pixel", "smooth"],
        volume: false,
      },
      checkpoint: {maxBytes: 132144, readFormats: ["wasm4-state-v1"], writeFormat: "wasm4-state-v1"},
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/client.mjs`,
      providerApiVersion: 1 as const,
      providerId: "retrom-runtime",
      providerVersion: "0.16.3",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/`,
      targetId: "wasm4",
    },
    schemaVersion: 1 as const,
    session: {
      coreName: "WASM-4 Core",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3",
      mode: "SINGLE" as const,
      platformName: "WASM-4",
      purpose: "PRODUCT" as const,
      returnTo: "/games/fixture",
      title: "Fixture",
      warnings: [],
    },
    targetOptions: {},
  };
}

export function rpgMvEnvelope(): LaunchEnvelopeV1 {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find(
    (entry) => entry.id === "rpgmaker-mv",
  );
  if (!target || !target.checkpoint) {throw new Error("RPG Maker MV target fixture missing");}
  return {
    netplay: null,
    resources: [{
      bootstrapTicket: "t".repeat(48),
      cleanupUrl: "https://runtime.test/__retrom/cleanup",
      contentDigest: digest,
      entryUrl: "https://runtime.test/__retrom/bootstrap",
      kind: "NATIVE_WEB",
      ordinal: 0,
      origin: "https://runtime.test",
      role: "game",
    }],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: target.capabilities,
      checkpoint: target.checkpoint,
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.16.3",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/`,
      targetId: "rpgmaker-mv",
    },
    schemaVersion: 1,
    session: {
      coreName: "RPG Maker Core",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3",
      mode: "SINGLE",
      platformName: "RPG Maker MV",
      purpose: "REVIEW_PREVIEW",
      returnTo: "/review/fixture",
      title: "Fixture",
      warnings: [],
    },
    targetOptions: {},
  };
}

export function targetEnvelope(targetId: string): LaunchEnvelopeV1 {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find((entry) => entry.id === targetId);
  if (!target) {throw new Error(`target fixture missing: ${targetId}`);}
  let resource: LaunchEnvelopeV1["resources"][number];
  if (["rpgmaker-xp", "rpgmaker-vx", "rpgmaker-vx-ace"].includes(targetId)) {
    resource = {
      kind: "SEEKABLE_BLOB", ordinal: 0, rangeRequired: true, role: "game",
      sha256: digest, sizeBytes: 4096, url: `/runtime/content/project/${digest}/game.mkxpz`,
    };
  } else if (["rpgmaker-mv", "rpgmaker-mz"].includes(targetId)) {
    resource = {
      bootstrapTicket: "t".repeat(48), cleanupUrl: "https://runtime.test/__retrom/cleanup",
      contentDigest: digest, entryUrl: "https://runtime.test/__retrom/bootstrap",
      kind: "NATIVE_WEB", ordinal: 0, origin: "https://runtime.test", role: "game",
    };
  } else if (targetId === "tyranoscript") {
    resource = {
      bootstrapTicket: "t".repeat(48), cleanupUrl: "https://runtime.test/__retrom/cleanup",
      contentDigest: digest, entryUrl: "https://runtime.test/__retrom/bootstrap",
      kind: "ISOLATED_WEB", ordinal: 0, origin: "https://runtime.test", role: "game",
    };
  } else if (targetId === "wasm4") {
    resource = {
      kind: "WASM4_CART", ordinal: 0, rangeRequired: false, role: "game",
      sha256: digest, sizeBytes: 128, url: "/runtime/content/game/cart.wasm",
    };
  } else {
    resource = {
      contentDigest: digest, indexUrl: `/runtime/content/project/${digest}/index.json`,
      kind: "FILE_TREE", ordinal: 0, role: "game",
    };
  }
  const targetOptions: LaunchEnvelopeV1["targetOptions"] = targetId === "onscripter-yuri"
      ? {scriptEncoding: "utf8"}
      : targetId === "kirikiri2-kag"
        ? {startupXp3Path: null}
        : {};
  return {
    netplay: null,
    resources: [resource],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: target.capabilities,
      checkpoint: target.checkpoint,
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.16.3",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/`,
      targetId,
    },
    schemaVersion: 1,
    session: {
      coreName: "Fixture Core",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", mode: "SINGLE",
      platformName: "Fixture", purpose: "PRODUCT", returnTo: "/games/fixture", title: "Fixture", warnings: [],
    },
    targetOptions,
  };
}

export function gamepad() {
  return {
    axes: [0.5, -0.5],
    buttons: Array.from({length: 16}, (_, index) => ({
      pressed: index === 0, touched: index === 0, value: index === 0 ? 1 : 0,
    })),
    connected: true,
    id: "fixture-pad",
    index: 0,
    mapping: "standard" as const,
    timestamp: 1,
  };
}

export function blankFrame() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  return {contentWindow: frame.contentWindow!, element: frame, origin: location.origin};
}
