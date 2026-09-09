import {describe, expect, it} from "vitest";
import {projectProviderManifest} from "../src/provider/manifest.js";
import {validateProviderLaunchRequest} from "../src/provider/module-api.js";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import * as parameters from "../src/providers/retrom-runtime/target-parameters.js";
import {wasmEnvelope} from "./provider-fixtures.js";

function fixture() {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find((item) => item.id === "scummvm");
  expect(target).toBeDefined();
  if (!target) {throw Error("ScummVM declaration missing");}
  const envelope = wasmEnvelope();
  Object.assign(envelope.runtime, {targetId: target.id, capabilities: target.capabilities, checkpoint: target.checkpoint});
  envelope.restore = null;
  envelope.resources = [{kind: "FILE_TREE", role: "game", ordinal: 0, contentDigest: "a".repeat(64), indexUrl: "/runtime/content/game/index.json"}];
  envelope.targetOptions = {engineId: "sky", gameId: "sky", root: "release", language: "en", platform: "pc",
    extra: "v0.0348 Floppy", guiOptions: "sndNoSpeech", filename: null};
  return {target, envelope};
}
describe("ScummVM Provider declaration", () => {
  it("declares native saves, standard input and the complete fixed plugin set", () => {
    const {target} = fixture();
    expect(target.checkpoint).toMatchObject({writeFormat: "scummvm-save-bundle-v1-storage-v1", semantics: "GAME_SAVE", maxBytes: 67108864});
    expect(target.capabilities).toMatchObject({standardGamepad: true, inputFilter: true, frameCounter: false, volume: false, requiresThreads: false});
    expect(target.assetPaths.filter((path) => path.startsWith("assets/scummvm/plugins/"))).toHaveLength(105);
    expect(target.assetPaths).toContain("assets/scummvm/native/linux-x86_64/scummvm-detector");
  });
  it("preserves the reviewed root and variant hints without auto-selecting a game at startup", () => {
    const {envelope} = fixture();
    validateProviderLaunchRequest(envelope, retromRuntimeProviderDefinition);
    const value = parameters.scummvm(envelope);
    expect(value.selection).toEqual(envelope.targetOptions);
    expect(value.projectIndexUrl).toBe("/runtime/content/game/index.json");
    expect(value.contentDigest).toBe("a".repeat(64));
  });
  it("rejects missing selections, undeclared engines and options outside the reviewed selection", () => {
    const {envelope} = fixture();
    for (const targetOptions of [{}, {...envelope.targetOptions, autoDetect: true}]) {
      expect(() => validateProviderLaunchRequest({...envelope, targetOptions}, retromRuntimeProviderDefinition)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    }
    expect(() => parameters.scummvm({...envelope, targetOptions: {...envelope.targetOptions, engineId: "unknown"}}))
      .toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });
});
