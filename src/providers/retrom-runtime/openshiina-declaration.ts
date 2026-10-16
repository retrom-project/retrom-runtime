import {defineAdapter, defineTarget} from "../../provider/declarations.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";
import siteAssets from "../../openshiina/site-assets.json" with {type: "json"};
import {maximumSaveBytes, saveFormat} from "../../openshiina/checkpoint.js";
const assets = siteAssets.map(path => `assets/openshiina/web/${path}`);
export const shiinaAdapter = defineAdapter({id: "openshiina-web", kind: "SHIINA_WEB", abi: "openshiina-web-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: true},
  checkpoint: {semantics: "GAME_SAVE", writeFormat: saveFormat, readFormats: [saveFormat]},
});
export const shiinaTarget = defineTarget({id: "shiina-rio", displayName: "ShiinaRio (OpenShiina)", adapterId: shiinaAdapter.id,
  checkpointMaxBytes: maximumSaveBytes, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: true,
  contentIO: {game: rangePolicy("SYNC_WORKER", contentLimits.indexedFile)},
  inputs: [{role: "game", kind: "FILE_TREE", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, nativeSettings: false, hostKeyboardShortcuts: ["PAUSE", "MENU"],
  videoModes: ["original", "pixel", "smooth"], assetPaths: assets, coreAssetPaths: assets.filter(path => !path.endsWith("/FONT-OFL.txt")),
});
