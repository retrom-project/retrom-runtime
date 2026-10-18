import {defineAdapter, defineTarget} from "../../provider/declarations.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";

export const siglusAdapter = defineAdapter({
  id: "siglus-web", kind: "SIGLUS_WEB", abi: "siglus-host-v1",
  capabilities: {checkpoint: true, frameCounter: true, pause: true, screenshot: true, standardGamepad: true, volume: true},
  checkpoint: {semantics: "GAME_SAVE", writeFormat: "siglus-save-files-v1", readFormats: ["siglus-save-files-v1"]},
});
export const siglusTarget = defineTarget({
  id: "siglus", displayName: "SiglusEngine", adapterId: siglusAdapter.id,
  assetPaths: ["assets/siglus/siglus.mjs", "assets/siglus/siglus_bg.wasm"],
  coreAssetPaths: ["assets/siglus/siglus.mjs", "assets/siglus/siglus_bg.wasm"],
  checkpointMaxBytes: 128 * 1024 * 1024,
  frameMode: "SAME_ORIGIN_BLANK", implementation: {}, inputFilter: true,
  hostKeyboardShortcuts: ["PAUSE", "MENU"], nativeSettings: false, requiresThreads: false,
  inputs: [{cardinality: "ONE", kind: "FILE_TREE", optional: false, role: "game"}],
  contentIO: {game: rangePolicy("ASYNC", contentLimits.indexedFile)},
  targetOptionsSchema: {type: "object", additionalProperties: false, required: ["language"],
    properties: {language: {type: "string", enum: ["chs", "original"]}}},
  videoModes: ["original", "pixel", "smooth"],
});
