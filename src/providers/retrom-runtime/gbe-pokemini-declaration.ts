import {defineAdapter, defineTarget} from "../../provider/declarations.js";
export const gbeAdapter = defineAdapter({id: "gbe-pokemini-web", kind: "GBE_POKEMINI_WEB", abi: "gbe-pokemini-host-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: true},
  checkpoint: {writeFormat: "gbe-pokemini-state-v1", readFormats: ["gbe-pokemini-state-v1"]},
});
export const gbeTarget = defineTarget({id: "gbe-pokemini", displayName: "Pokémon Mini (GBE+)", adapterId: gbeAdapter.id,
  checkpointMaxBytes: 1024 * 1024, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: false,
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, discSwitch: false, nativeSettings: false, netplayPort: false,
  videoModes: ["original", "pixel", "smooth"],
  assetPaths: ["gbe-pokemini.mjs", "gbe-pokemini.wasm", "gbe-pokemini-register.mjs"].map(file => `assets/gbe_plus/${file}`),
});
