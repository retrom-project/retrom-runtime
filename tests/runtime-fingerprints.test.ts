// @vitest-environment node
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {expect, it} from "vitest";
import {fingerprintProvider} from "../scripts/runtime-fingerprints.mjs";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";

const definition = {...retromRuntimeProviderDefinition,
  targets: retromRuntimeProviderDefinition.targets.filter(target => ["wasm4", "scummvm"].includes(target.id))};
const index = Object.fromEntries(definition.targets.flatMap(target => target.assetPaths).map(path =>
  [path, {sha256: "a".repeat(64), sizeBytes: 1}]));
it("builds stable Target identities and changes only the selected execution closure", async () => {
  const first = await fingerprintProvider(definition, index);
  expect(await fingerprintProvider(definition, index)).toEqual(first);
  const path = resolve("src/wasm4/adapter.ts"), source = await readFile(path, "utf8");
  const own = await fingerprintProvider(definition, index, {[path]: source.replaceAll("WASM4_CORE_LOAD_FAILED", "WASM4_CORE_LOAD_ERROR")});
  expect(own.wasm4.fingerprint).not.toBe(first.wasm4.fingerprint);
  expect(own.scummvm.fingerprint).toBe(first.scummvm.fingerprint);
  const target = definition.targets.find(item => item.id === "wasm4")!;
  const asset = target.assetPaths.find(item => item.endsWith(".mjs"))!;
  const core = await fingerprintProvider(definition, {...index, [asset]: {...index[asset], sha256: "b".repeat(64)}});
  expect(core.wasm4.fingerprint).not.toBe(first.wasm4.fingerprint);
  expect(core.scummvm.fingerprint).toBe(first.scummvm.fingerprint);
  const codecPath = resolve("src/provider/checkpoint-storage.ts"), codec = await readFile(codecPath, "utf8");
  const common = await fingerprintProvider(definition, index, {[codecPath]: codec.replace('const suffix = "-storage-v1";', 'const suffix = "-storage-test";')});
  expect(common.wasm4.fingerprint).not.toBe(first.wasm4.fingerprint);
  expect(common.scummvm.fingerprint).not.toBe(first.scummvm.fingerprint);
});

it("excludes another EmulatorJS core's native save implementation from the selected identity", async () => {
  const selected = {...emulatorJsProviderDefinition,
    targets: emulatorJsProviderDefinition.targets.filter(target => ["fceumm", "lutro"].includes(target.id))};
  const assets = Object.fromEntries(selected.targets.flatMap(target => target.assetPaths).map(path =>
    [path, {sha256: "a".repeat(64), sizeBytes: 1}]));
  const path = resolve("src/providers/emulatorjs/lutro-native-save.ts"), source = await readFile(path, "utf8");
  const first = await fingerprintProvider(selected, assets);
  const changed = await fingerprintProvider(selected, assets, {[path]:
    `${source.replace("this.exported.size > 8", "this.exported.size > capturedRevisionLimit()")}\nfunction capturedRevisionLimit() {return 7;}\n`});
  expect(changed.lutro.fingerprint).not.toBe(first.lutro.fingerprint);
  expect(changed.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
  const withoutHelper = source.replace(/async function saveRevision\(bytes: Uint8Array\) \{[\s\S]*?\n\}/u, "")
    .replace("await saveRevision(raw)", "String(raw.length)").replace("await saveRevision(bytes)", "String(bytes.length)");
  const restructured = await fingerprintProvider(selected, assets, {[path]: withoutHelper});
  expect(restructured.lutro.fingerprint).not.toBe(first.lutro.fingerprint);
  expect(restructured.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
  const constructorChanged = await fingerprintProvider(selected, assets, {[path]: source.replace("new Map<string, number>()", "new WeakMap<string, number>()")});
  expect(constructorChanged.lutro.fingerprint).not.toBe(first.lutro.fingerprint);
  expect(constructorChanged.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
});

it("includes Parent archive execution only in the arcade core closure", async () => {
  const selected = {...emulatorJsProviderDefinition,
    targets: emulatorJsProviderDefinition.targets.filter(target => ["fceumm", "fbneo"].includes(target.id))};
  const assets = Object.fromEntries(selected.targets.flatMap(target => target.assetPaths).map(path =>
    [path, {sha256: "a".repeat(64), sizeBytes: 1}]));
  const path = resolve("src/providers/emulatorjs/parent-archive.ts"), source = await readFile(path, "utf8");
  const first = await fingerprintProvider(selected, assets);
  const changed = await fingerprintProvider(selected, assets, {[path]: source.replaceAll("PLAYER_PARENT_ARCHIVE_UNAVAILABLE", "PLAYER_PARENT_ARCHIVE_FAILED")});
  expect(changed.fbneo.fingerprint).not.toBe(first.fbneo.fingerprint);
  expect(changed.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
});

it("keeps DOS index parsing in the DOS execution closure", async () => {
  const selected = {...emulatorJsProviderDefinition,
    targets: emulatorJsProviderDefinition.targets.filter(target => ["fceumm", "dosbox-pure"].includes(target.id))};
  const assets = Object.fromEntries(selected.targets.flatMap(target => target.assetPaths).map(path =>
    [path, {sha256: "a".repeat(64), sizeBytes: 1}]));
  const path = resolve("src/providers/emulatorjs/dosbox-range.ts"), source = await readFile(path, "utf8");
  const first = await fingerprintProvider(selected, assets);
  const changed = await fingerprintProvider(selected, assets, {[path]: source.replaceAll("DOSBOX_CONTENT_INDEX_INVALID", "DOSBOX_CONTENT_INDEX_REJECTED")});
  expect(changed["dosbox-pure"].fingerprint).not.toBe(first["dosbox-pure"].fingerprint);
  expect(changed.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
  for (const module of ["dosbox-autoboot.ts", "dosbox-menu-input.ts"]) {
    const file = resolve("src/providers/emulatorjs", module), original = await readFile(file, "utf8");
    const modified = module === "dosbox-autoboot.ts" ? original.replace("C:\\\\", "D:\\\\") :
      original.replace("ArrowUp: 4", "ArrowUp: 5");
    expect(modified).not.toBe(original);
    const affected = await fingerprintProvider(selected, assets, {[file]: modified});
    expect(affected["dosbox-pure"].fingerprint).not.toBe(first["dosbox-pure"].fingerprint);
    expect(affected.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
  }
});


it("keeps explicit Thomson machine dispatch out of every other core execution closure", async () => {
  const selected = {...emulatorJsProviderDefinition,
    targets: emulatorJsProviderDefinition.targets.filter(target => ["fceumm", "theodore", "dosbox-pure"].includes(target.id))};
  const assets = Object.fromEntries(selected.targets.flatMap(target => target.assetPaths).map(path =>
    [path, {sha256: "a".repeat(64), sizeBytes: 1}]));
  const path = resolve("src/providers/emulatorjs/default-controls.ts"), source = await readFile(path, "utf8");
  const changedSource = source.replace("{theodore_rom: options.thomsonModel}",
    "{theodore_rom: String(options.thomsonModel).trim()}");
  expect(changedSource).not.toBe(source);
  const first = await fingerprintProvider(selected, assets);
  const changed = await fingerprintProvider(selected, assets, {[path]: changedSource});
  expect(changed.theodore.fingerprint).not.toBe(first.theodore.fingerprint);
  expect(changed.fceumm.fingerprint).toBe(first.fceumm.fingerprint);
  expect(changed["dosbox-pure"].fingerprint).toBe(first["dosbox-pure"].fingerprint);
});
