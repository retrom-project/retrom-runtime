import {defineAdapter, defineTarget} from "../../provider/declarations.js";
export const np2kaiAdapter = defineAdapter({id: "np2kai-web", kind: "NP2KAI_WEB", abi: "np2kai-host-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: false},
  checkpoint: {writeFormat: "np2kai-state-v1", readFormats: ["np2kai-state-v1"]},
});
export const np2kaiTarget = defineTarget({id: "np2kai-pc98", displayName: "PC-98 (Neko Project II Kai)", adapterId: np2kaiAdapter.id,
  checkpointMaxBytes: 402653184, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: false,
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, discSwitch: false, nativeSettings: false, netplayPort: false,
  videoModes: ["original", "pixel", "smooth"],
  assetPaths: ["font.bmp", "np2kai-register.mjs", "np2kai.mjs", "np2kai.wasm"].map(file => `assets/np2kai/${file}`),
});
