import {describe, expect, it} from "vitest";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {projectProviderManifest} from "../provider/manifest.js";
describe("independent PSP target", () => {
  it("declares its own ABI, bounded instant checkpoint and standard controls", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    const target = manifest.targets.find(entry => entry.id === "ppsspp");
    expect(target).toBeDefined();
    expect(target?.capabilities).toMatchObject({requiresThreads: true, standardGamepad: true, checkpoint: true, pause: true, volume: true});
    expect(target?.checkpoint).toMatchObject({writeFormat: "ppsspp-state-v1-storage-v1", maxBytes: 268435456});
    expect(target?.checkpoint?.readFormats).not.toContain("emulatorjs-state-v1-storage-v1");
    expect(target?.inputs).toEqual([{cardinality: "ONE", kind: "SEEKABLE_BLOB", optional: false, role: "game"}]);
    expect(target?.targetOptionsSchema).toEqual({type: "object", additionalProperties: false, properties: {}, required: []});
  });
});
