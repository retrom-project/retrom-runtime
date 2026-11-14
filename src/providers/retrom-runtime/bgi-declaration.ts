import {defineAdapter, defineTarget} from "../../provider/declarations.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";
const files = ["ethornell.mjs", "ethornell-worker.mjs", "ethornell_bg.wasm", "audio-worklet.mjs", "font.ttf"]
  .map(file => `assets/ethornell/${file}`);
export const bgiAdapter = defineAdapter({id: "ethornell-web", kind: "BGI_WEB", abi: "ethornell-host-v1",
  capabilities: {checkpoint: true, frameCounter: true, pause: true, screenshot: true, standardGamepad: true, volume: true},
  checkpoint: {semantics: "GAME_SAVE", writeFormat: "bgi-save-files-v1", readFormats: ["bgi-save-files-v1"]}});
export const bgiTarget = defineTarget({id: "bgi", displayName: "BGI / Ethornell", adapterId: bgiAdapter.id,
  assetPaths: files, coreAssetPaths: files, checkpointMaxBytes: 128 * 1024 * 1024,
  frameMode: "SAME_ORIGIN_BLANK", implementation: {}, inputFilter: true,
  hostKeyboardShortcuts: ["PAUSE", "MENU"], nativeSettings: false, requiresThreads: true,
  inputs: [{cardinality: "ONE", kind: "FILE_TREE", optional: false, role: "game"}],
  contentIO: {game: rangePolicy("SYNC_WORKER", contentLimits.indexedFile)},
  targetOptionsSchema: {type: "object", additionalProperties: false, required: ["textEncoding"],
    properties: {textEncoding: {type: "string", enum: ["cp932", "gbk"]}}},
  videoModes: ["original", "pixel", "smooth"]});
