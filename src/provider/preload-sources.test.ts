import {afterEach, expect, it, vi} from "vitest";
import {wasmEnvelope} from "../../tests/provider-fixtures.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {preloadSources} from "./preload-sources.js";
import {fetchMetadataJson} from "./metadata.js";
import {rangePolicy} from "./content-policies.js";

vi.mock("./metadata.js", async original => ({...await original<typeof import("./metadata.js")>(), fetchMetadataJson: vi.fn()}));
afterEach(() => vi.resetAllMocks());
const target = {...retromRuntimeProviderDefinition.targets.find(value => value.id === "wasm4")!,
  contentIO: {game: rangePolicy("ASYNC", 1024 * 1024)}};
const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]};
const signal = new AbortController().signal;

it("prepares every indexed member using the same project identity as the lazy reader", async () => {
  const envelope = wasmEnvelope();
  envelope.resources = [{kind: "FILE_TREE", role: "game", ordinal: 0, indexUrl: "/project/index.json", contentDigest: "b".repeat(64)}];
  vi.mocked(fetchMetadataJson).mockResolvedValue({schemaVersion: 1, files: [
    {path: "start.dat", sizeBytes: 3, url: "start.dat"}, {path: "later/level.dat", sizeBytes: 5, url: "later/level.dat"},
  ]});
  const sources = await preloadSources(target, envelope, {}, context, signal);
  expect(sources.map(source => source.identity)).toEqual([
    {kind: "INDEX_ENTRY", projectDigest: "b".repeat(64), logicalPath: "start.dat"},
    {kind: "INDEX_ENTRY", projectDigest: "b".repeat(64), logicalPath: "later/level.dat"},
  ]);
  expect(sources.map(source => source.url)).toEqual([`${location.origin}/project/start.dat`, `${location.origin}/project/later/level.dat`]);
});

it.each([
  {path: "../escape", sizeBytes: 3, url: "a"},
  {path: "a", sizeBytes: 3, url: "https://untrusted.test/a"},
  {path: "a", sizeBytes: 1024 * 1024 + 1, url: "a"},
])("rejects an unsafe or oversized project member before preparing content", async file => {
  const envelope = wasmEnvelope();
  envelope.resources = [{kind: "FILE_TREE", role: "game", ordinal: 0, indexUrl: "/project/index.json", contentDigest: "b".repeat(64)}];
  vi.mocked(fetchMetadataJson).mockResolvedValue({schemaVersion: 1, files: [file]});
  await expect(preloadSources(target, envelope, {}, context, signal)).rejects.toThrow("SOURCE_INVALID");
});

it("uses the firmware and parent cache identities and includes declared lazy core data", async () => {
  const envelope = wasmEnvelope();
  envelope.resources = [
    {kind: "PARENT_ARCHIVE", role: "parent", ordinal: 0, sha256: "c".repeat(64), sizeBytes: 3, url: "/parent", rangeRequired: true},
    {kind: "BIOS_BUNDLE", role: "bios", ordinal: 1,
      files: [{logicalName: "bios.bin", virtualPath: "bios.bin", sha256: "d".repeat(64), sizeBytes: 4, url: "/bios"}]},
  ];
  const declaration = {...target, assetPaths: ["data/engine.dat"], preloadAssetPaths: ["data/engine.dat"],
    contentIO: {...target.contentIO, parent: target.contentIO.game, bios: target.contentIO.game}};
  const sources = await preloadSources(declaration, envelope, {"data/engine.dat": {sha256: "e".repeat(64), sizeBytes: 5}}, context, signal);
  expect(sources.map(source => [source.purpose, source.identity])).toEqual([
    ["GAME", {kind: "FILE_SHA256", sha256: "c".repeat(64)}],
    ["FIRMWARE", {kind: "FILE_SHA256", sha256: "d".repeat(64)}],
    ["CORE_ASSET", {kind: "FILE_SHA256", sha256: "e".repeat(64)}],
  ]);
});
