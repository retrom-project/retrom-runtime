import {createHash} from "node:crypto";

import type {LaunchEnvelopeV1} from "../src/provider/module-api.js";
import {canonicalJsonBytes} from "../src/provider/contract.js";
import {projectProviderManifest} from "../src/provider/manifest.js";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";

const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);

export function launchEnvelope(): LaunchEnvelopeV1 {
  return {
    netplay: null,
    resources: [{
      kind: "ROM_BLOB_V1", ordinal: 0, rangeRequired: false, role: "game",
      sha256: digest, sizeBytes: 128, url: "/runtime/content/game/game.nes",
    }],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: {
        checkpoint: true, discSwitch: false, frameCounter: true, frameMode: "SAME_ORIGIN_BLANK",
        inputFilter: true, nativeSettings: true, netplayPort: true, pause: true, requiresThreads: false,
        screenshot: true, standardGamepad: true, validationProbes: [],
        videoModes: ["adaptive-sharpen", "original", "pixel", "sharp-bilinear", "smooth"], volume: true,
      },
      checkpoint: {maxBytes: 268435456, readFormats: ["emulatorjs-state-v1"], writeFormat: "emulatorjs-state-v1"},
      gameCompatibilityLine: "fceumm-v1",
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/emulatorjs/${bundleDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "emulatorjs",
      providerVersion: "1.0.0",
      runtimeBaseUrl: `/runtime/providers/emulatorjs/${bundleDigest}/`,
      targetContractSha256: digestTarget("fceumm"),
      targetId: "fceumm",
    },
    schemaVersion: 1,
    session: {
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", mode: "SINGLE", platformName: "NES",
      purpose: "PRODUCT", returnTo: "/games/fixture", title: "Fixture", warnings: [],
    },
    targetOptions: {dosEntryPath: null, initialDiscIndex: null, kind: "EMULATORJS_V1"},
    validation: null,
  };
}

function digestTarget(id: string) {
  const target = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === id);
  if (!target) {throw new Error("target fixture missing");}
  return createHash("sha256").update(canonicalJsonBytes(target)).digest("hex");
}
