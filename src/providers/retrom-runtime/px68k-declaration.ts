import {defineAdapter, defineTarget} from "../../provider/declarations.js";
export const px68kAdapter = defineAdapter({id: "px68k-web", kind: "PX68K_WEB", abi: "px68k-host-v1",
  capabilities: {checkpoint: true, frameCounter: true, pause: true, screenshot: true, standardGamepad: true, volume: true},
  checkpoint: {writeFormat: "px68k-state-v1", readFormats: ["px68k-state-v1"]}});
export const px68kTarget = defineTarget({id: "px68k", displayName: "Sharp X68000 (PX68K)", adapterId: "px68k-web",
  assetPaths: ["assets/px68k/px68k-retrom.mjs", "assets/px68k/px68k-retrom.wasm"],
  checkpointMaxBytes: 96 * 1024 * 1024, discSwitch: false, frameMode: "SAME_ORIGIN_BLANK", inputFilter: true,
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: false}],
  implementation: {}, nativeSettings: false, netplayPort: false, requiresThreads: false, videoModes: ["original", "pixel", "smooth"],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
});
