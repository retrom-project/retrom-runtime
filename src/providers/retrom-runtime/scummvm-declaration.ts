import {defineAdapter, defineTarget, type TargetOptionsSchema} from "../../provider/declarations.js";
import layout from "../../scummvm/core-layout.json" with {type: "json"};

const options = {type: "object", additionalProperties: false,
  properties: {
    engineId: {type: "string", minLength: 1, maxLength: 128},
    gameId: {type: "string", minLength: 1, maxLength: 128},
    root: {type: "string", maxLength: 2048},
    language: {type: "string", maxLength: 128},
    platform: {type: "string", maxLength: 128},
    extra: {type: "string", maxLength: 4096},
    guiOptions: {type: "string", maxLength: 4096},
    filename: {type: ["string", "null"], format: "safe-path", maxLength: 240},
  }, required: ["engineId", "extra", "filename", "gameId", "guiOptions", "language", "platform", "root"],
} as const satisfies TargetOptionsSchema;

export const scummvmAdapter = defineAdapter({id: "scummvm-web", kind: "SCUMMVM_WEB", abi: "scummvm-host-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: false, volume: false},
  checkpoint: {writeFormat: "scummvm-save-bundle-v1", readFormats: ["scummvm-save-bundle-v1"], semantics: "GAME_SAVE"},
});
export const scummvmTarget = defineTarget({id: "scummvm", displayName: "ScummVM", adapterId: scummvmAdapter.id,
  checkpointMaxBytes: 64 * 1024 * 1024, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: false,
  inputs: [{role: "game", kind: "FILE_TREE", cardinality: "ONE", optional: false}],
  targetOptionsSchema: options, implementation: {}, inputFilter: true, discSwitch: false, nativeSettings: false,
  netplayPort: false, videoModes: ["original", "pixel", "smooth"],
  assetPaths: layout.files.filter((file) => !file.path.startsWith("licenses/")).map((file) => `assets/scummvm/${file.path}`),
});
