import type {LaunchEnvelopeV1} from "../src/provider/module-api.js";

const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);

export function launchEnvelope(): LaunchEnvelopeV1 {
  return {
    netplay: null,
    resources: [{
      kind: "ROM_BLOB", ordinal: 0, rangeRequired: false, role: "game",
      sha256: digest, sizeBytes: 128, url: "/runtime/content/game/game.nes",
    }],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: {
        checkpoint: true, discSwitch: false, frameCounter: true, frameMode: "SAME_ORIGIN_BLANK",
        inputFilter: true, nativeSettings: true, netplayPort: true, pause: true, requiresThreads: false,
        screenshot: true, standardGamepad: true,
        videoModes: ["adaptive-sharpen", "original", "pixel", "sharp-bilinear", "smooth"], volume: true,
      },
      checkpoint: {maxBytes: 268435456, readFormats: ["emulatorjs-state-v1"], writeFormat: "emulatorjs-state-v1"},
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/emulatorjs/${bundleDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "emulatorjs",
      providerVersion: "2.2.2",
      runtimeBaseUrl: `/runtime/providers/emulatorjs/${bundleDigest}/`,
      targetId: "fceumm",
    },
    schemaVersion: 1,
    session: {
      coreName: "FCEUmm",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", mode: "SINGLE", platformName: "NES",
      purpose: "PRODUCT", returnTo: "/games/fixture", title: "Fixture", warnings: [],
    },
    targetOptions: {dosEntryPath: null, initialDiscIndex: null},
  };
}
