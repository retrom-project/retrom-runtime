// @vitest-environment node
import {expect, it} from "vitest";
import {fingerprintProvider} from "../scripts/runtime-fingerprints.mjs";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import {restorability} from "../src/runtime/identity.js";

const emulator = {...emulatorJsProviderDefinition,
  targets: emulatorJsProviderDefinition.targets.filter(target => ["yabause", "fceumm"].includes(target.id))};
const native = {...retromRuntimeProviderDefinition,
  targets: retromRuntimeProviderDefinition.targets.filter(target => ["wasm4", "rpgmaker-mv"].includes(target.id))};
const assets = (definition: typeof emulator | typeof native) => Object.fromEntries(
  definition.targets.flatMap(target => target.assetPaths).map(path => [path, {sha256: "a".repeat(64), sizeBytes: 1}]));

it("keeps saves available after frontend assets and runtime presentation declarations change", async () => {
  const index = assets(emulator), before = await fingerprintProvider(emulator, index);
  const changed = {...emulator, providerVersion: "999.0.0", targets: emulator.targets.map(target => ({...target,
    displayName: `${target.displayName} updated`, videoModes: ["original" as const],
    implementation: {...target.implementation, outputSizeLimit: {width: 800, height: 600}},
  }))};
  const after = await fingerprintProvider(changed, {...index,
    "assets/4.2.3/data/src/gamepad.js": {sha256: "b".repeat(64), sizeBytes: 2},
    "assets/content-io/worker.mjs": {sha256: "c".repeat(64), sizeBytes: 3},
  });
  const current = {coreId: "yabause", providerId: "emulatorjs", targetId: "yabause",
    coreFingerprint: after.yabause.fingerprint, romHash: "d".repeat(64)};
  const format = "emulatorjs-state-v1-storage-v1";
  expect(restorability({gameAvailable: true, saveAvailable: true, current,
    context: {...current, coreFingerprint: before.yabause.fingerprint, checkpointFormat: format,
      content: {kind: "SINGLE_FILE", entryFile: "game.chd"}, runtimeOptions: {dosEntryPath: null}},
    readFormats: [format]})).toEqual({restorable: true, reason: null});
});

it("excludes the native host bridge while keeping the packaged core protected", async () => {
  const index = assets(native), before = await fingerprintProvider(native, index);
  const bridge = await fingerprintProvider(native, {...index,
    "assets/native/bridge.js": {sha256: "b".repeat(64), sizeBytes: 2}});
  expect(bridge["rpgmaker-mv"].fingerprint).toBe(before["rpgmaker-mv"].fingerprint);
  const core = await fingerprintProvider(native, {...index,
    "assets/wasm4/wasm4-retrom.mjs": {sha256: "c".repeat(64), sizeBytes: 3}});
  expect(core.wasm4.fingerprint).not.toBe(before.wasm4.fingerprint);
  expect(core["rpgmaker-mv"].fingerprint).toBe(before["rpgmaker-mv"].fingerprint);
});
