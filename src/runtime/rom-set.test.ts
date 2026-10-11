import {expect, it} from "vitest";
import {prepareRuntime, resolveSavedRuntimeRequest} from "./prepare.js";
import {runtimeCatalog} from "./catalog.js";
import {arcadeParentOptions} from "./arcade-parent.js";
import {arcadeROMSetOptions, reconcileArcadeConfiguration} from "./rom-set.js";

const cores = ["fbneo", "mame2003", "mame2003_plus", "mame_arcade"];
const file = {logicalKey: "original.zip", name: "original.zip", sha256: "a".repeat(64), sizeBytes: 1};
const catalog = {
  chosen: {parent: null, bios: false, roms: []},
  clone: {parent: "parent", bios: false, roms: [{name: "p.bin", size: "1", crc: "abcdef12", merge: "p.bin"}]},
  parent: {parent: null, bios: false, roms: [{name: "p.bin", size: "1", crc: "abcdef12"}]},
};
function request(coreId: string) {
  const binding = runtimeCatalog().bindings.find(binding => binding.coreId === coreId)!;
  return {coreId, directory: {platformId: "arcade", defaultCoreId: coreId, allowedCoreIds: cores},
    files: [file], config: {content: {kind: "ARCADE", entryFile: file.logicalKey}, cores: {[coreId]: {romSet: "chosen"}}},
    archives: {[file.logicalKey]: []}, arcadeCatalog: catalog,
    fingerprints: {[`${binding.providerId}/${binding.targetId}`]: "b".repeat(64)}};
}
it.each(cores)("%s selects the DAT driver without altering the original ROM bytes or identity", coreId => {
  const input = request(coreId), result = prepareRuntime(input);
  expect(result.romHash).toBe(file.sha256);
  expect(result.resources[0].files).toEqual([file.logicalKey]);
  expect(result.config.cores?.[coreId].romSet).toBe("chosen");
  if (coreId === "mame_arcade") {expect(result.targetOptions.machine).toBe("chosen");}
  else {expect(result.resources[0].paths).toEqual({[file.logicalKey]: "chosen.zip"});}
  expect(prepareRuntime(input).dependencies.missingParents).toEqual([]);
});
it.each(cores)("%s uses its own selection and the selected entry's Parent requirement", coreId => {
  const input = request(coreId);
  const config = {...input.config, cores: {...Object.fromEntries(cores.filter(core => core !== coreId).map(core => [core, {romSet: "clone"}])),
    [coreId]: {romSet: "chosen"}}};
  expect(arcadeParentOptions({...input, config}).missingParents).toEqual([]);
  config.cores[coreId].romSet = "clone";
  expect(arcadeParentOptions({...input, config}).missingParents).toEqual(["parent.zip"]);
});
it.each(cores)("%s restores the frozen selection after the current DAT selection changes", coreId => {
  const input = request(coreId), prepared = prepareRuntime(input);
  const context = {coreId, providerId: prepared.providerId, targetId: prepared.targetId,
    coreFingerprint: prepared.coreFingerprint, romHash: prepared.romHash, checkpointFormat: prepared.checkpoint!.writeFormat,
    content: input.config.content, runtimeOptions: prepared.targetOptions, romSet: "chosen"};
  const restored = resolveSavedRuntimeRequest({...input,
    config: {...input.config, cores: {[coreId]: {romSet: "clone"}}}, savedContext: context});
  expect(restored.config).toMatchObject({cores: {[coreId]: {romSet: "chosen"}}});
  expect(prepareRuntime(restored).dependencies.missingParents).toEqual([]);
});

it.each(cores)("%s searches names and versions, excludes firmware and keeps the selected entry outside the page", coreId => {
  const input = request(coreId);
  const arcadeCatalog = {...catalog,
    chosen: {...catalog.chosen, description: "Chosen Game (version 2)", year: "1990", manufacturer: "Maker"},
    firmware: {parent: null, bios: true, roms: []}, device: {parent: null, bios: false, device: true, roms: []},
    inactive: {parent: null, bios: false, runnable: false, roms: []}};
  const options = arcadeROMSetOptions({...input, arcadeCatalog, query: "version 2", limit: 1});
  expect(options.entries.map(entry => entry.name)).toEqual(["chosen"]);
  expect(arcadeROMSetOptions({...input, arcadeCatalog, query: "maker"}).total).toBe(1);
  expect(arcadeROMSetOptions({...input, arcadeCatalog, query: "parent"})).toMatchObject({total: 1, selected: {name: "chosen"}});
  expect(arcadeROMSetOptions({...input, arcadeCatalog, romSet: "", query: "", limit: 100})).toMatchObject({automaticSelection: null, selected: null, total: 3});
  expect(() => arcadeROMSetOptions({...input, arcadeCatalog, coreId: "fceumm"})).toThrow("RUNTIME_CORE_UNAVAILABLE");
});

it.each(cores)("%s retires only obsolete parents, retaining another core's reference and the original entry", coreId => {
  const input = request(coreId), otherCore = cores.find(core => core !== coreId)!;
  const files = [file, {...file, name: "parent.zip", logicalKey: "parent.zip"}, {...file, name: "unrelated.zip", logicalKey: "unrelated.zip"}];
  const previousConfig = {content: input.config.content, cores: {[coreId]: {romSet: "clone", parentFiles: ["parent.zip"]}}};
  const arcadeCatalogs = Object.fromEntries(cores.map(core => [core, catalog]));
  expect(reconcileArcadeConfiguration({...input, files, previousConfig, arcadeCatalogs,
    config: {...previousConfig, cores: {[coreId]: {romSet: "chosen", parentFiles: ["parent.zip"]}}}}))
    .toMatchObject({removedParentFiles: ["parent.zip"], config: {cores: {[coreId]: {romSet: "chosen", parentFiles: []}}}});
  const shared = {...previousConfig, cores: {...previousConfig.cores, [otherCore]: {romSet: "clone", parentFiles: ["parent.zip"]}}};
  const result = reconcileArcadeConfiguration({...input, files, previousConfig: shared, arcadeCatalogs,
    config: {...shared, cores: {...shared.cores, [coreId]: {romSet: "chosen", parentFiles: ["parent.zip"]}}}});
  expect(result.removedParentFiles).toEqual([]);
  expect(result.config.cores?.[otherCore]).toEqual(shared.cores[otherCore]);
  const restricted = reconcileArcadeConfiguration({...input, files, previousConfig: shared, arcadeCatalogs,
    directory: {...input.directory, allowedCoreIds: [coreId]},
    config: {...shared, cores: {...shared.cores, [coreId]: {romSet: "chosen", parentFiles: ["parent.zip"]}}}});
  expect(restricted.config.cores?.[otherCore]).toEqual(shared.cores[otherCore]);
  expect(restricted.removedParentFiles).toEqual([]);
  expect(() => reconcileArcadeConfiguration({...input, files, previousConfig, arcadeCatalogs,
    config: {...previousConfig, cores: {[coreId]: {romSet: "firmware"}}}})).toThrow("RUNTIME_ROM_SET_INVALID");
});
