// @vitest-environment node
import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {fingerprintProvider} from "../scripts/runtime-fingerprints.mjs";
import {defineTarget} from "../src/provider/declarations.js";
import {runtimeProviders} from "../src/runtime/catalog.js";

const indexFor = (paths: readonly string[]) => Object.fromEntries(paths.map(path =>
  [path, {sha256: createHash("sha256").update(path).digest("hex"), sizeBytes: 1}]));

it.each(runtimeProviders)("keeps $providerId identities stable across packaging and non-core changes", async definition => {
  const index = indexFor(definition.targets.flatMap(target => target.assetPaths));
  const first = await fingerprintProvider(definition, index);
  expect(await fingerprintProvider(definition, index)).toEqual(first);
  const core = new Set(definition.targets.flatMap(target => target.coreAssetPaths));
  const changedIndex = Object.fromEntries(Object.entries(index).map(([path, value]) =>
    [path, core.has(path) ? value : {sha256: "f".repeat(64), sizeBytes: 9}]));
  const changed = {...definition, providerVersion: "999.0.0", adapters: definition.adapters.map(adapter => ({...adapter,
    abi: "changed-host-api", capabilities: {...adapter.capabilities, screenshot: false},
  })), targets: definition.targets.map(target => ({...target, displayName: "renamed", implementation: {changed: true}}))};
  expect(await fingerprintProvider(changed, changedIndex)).toEqual(first);
});

it.each(runtimeProviders)("changes only $providerId Targets that declare the changed core asset", async definition => {
  const index = indexFor(definition.targets.flatMap(target => target.assetPaths));
  const first = await fingerprintProvider(definition, index);
  for (const path of new Set(definition.targets.flatMap(target => target.coreAssetPaths))) {
    const changed = await fingerprintProvider(definition, {...index, [path]: {sha256: "b".repeat(64), sizeBytes: 2}});
    for (const target of definition.targets) {
      expect(changed[target.id].fingerprint === first[target.id].fingerprint,
        `${target.id}: ${path}`).toBe(!target.coreAssetPaths.includes(path));
    }
  }
});

it("does not use artifact paths, ordering or other Target declarations as save identity", async () => {
  const provider = runtimeProviders.find(item => item.providerId === "emulatorjs")!;
  const target = provider.targets.find(item => item.id === "yabause")!;
  const definition = {...provider, targets: [target]};
  const index = indexFor(target.assetPaths), before = await fingerprintProvider(definition, index);
  const relocate = (path: string) => `relocated/${path}`;
  const renamed = {...target, assetPaths: target.assetPaths.map(relocate).reverse(),
    coreAssetPaths: target.coreAssetPaths.map(relocate).reverse()};
  const relocatedIndex = Object.fromEntries(Object.entries(index).map(([path, identity]) => [relocate(path), identity]));
  const after = await fingerprintProvider({...definition, targets: [renamed, {...renamed, id: "another-target"}]}, relocatedIndex);
  expect(after.yabause.fingerprint).toBe(before.yabause.fingerprint);
  expect(after["another-target"].fingerprint).not.toBe(before.yabause.fingerprint);
  const otherProvider = await fingerprintProvider({...definition, providerId: "another-provider"}, index);
  expect(otherProvider.yabause.fingerprint).not.toBe(before.yabause.fingerprint);
});

it("requires explicit declared core assets and verified bytes", async () => {
  const provider = runtimeProviders.find(item => item.providerId === "emulatorjs")!;
  const target = provider.targets.find(item => item.id === "yabause")!;
  const definition = {...provider, targets: [target]}, path = target.coreAssetPaths[0];
  await expect(fingerprintProvider(definition, {})).rejects.toThrow(`RUNTIME_IMPLEMENTATION_ASSET_MISSING:${path}`);
  await expect(fingerprintProvider(definition, {[path]: {sha256: "invalid", sizeBytes: 1}}))
    .rejects.toThrow(`RUNTIME_IMPLEMENTATION_ASSET_MISSING:${path}`);
  expect(() => defineTarget({...target, coreAssetPaths: [path, path]})).toThrow("PROVIDER_CORE_ASSETS_INVALID");
  expect(() => defineTarget({...target, coreAssetPaths: ["undeclared.wasm"]})).toThrow("PROVIDER_CORE_ASSETS_INVALID");
});

it("declares core bytes for every packaged engine and excludes runtime-owned bridges", () => {
  const targets = runtimeProviders.flatMap(provider => provider.targets);
  expect(targets).toHaveLength(111);
  expect(targets.filter(target => target.coreAssetPaths.length === 0).map(target => target.id).sort())
    .toEqual(["rpgmaker-mv", "rpgmaker-mz", "tyranoscript"]);
  for (const target of targets) {
    expect(target.coreAssetPaths.some(path => path.startsWith("assets/content-io/"))).toBe(false);
    expect(target.coreAssetPaths).not.toContain("assets/butterscotch/worker.mjs");
    expect(target.coreAssetPaths).not.toContain("assets/mame/mame-build.json");
  }
});
