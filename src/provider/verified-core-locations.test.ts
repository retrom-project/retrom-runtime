import {expect, it, vi} from "vitest";
import {loadCore as fantasy} from "../fantasy-console/core.js";
import {loadCore as nxengine} from "../nxengine/core.js";
import {loadCore as px68k} from "../px68k/core.js";
import {loadCore as gbe} from "../gbe-pokemini/core.js";
import {loadCore as np2kai} from "../np2kai/core.js";
import type {AdapterContentSession} from "./content-inputs.js";

const factory = vi.hoisted(() => vi.fn());
vi.mock("./verified-module.js", () => ({
  importVerifiedModule: async () => ({default: factory}),
  importVerifiedFrameModule: async () => ({default: factory}),
}));
vi.mock("../fantasy-console/fetch.js", () => ({verifiedFetch: async () => Uint8Array.of(1)}));
vi.mock("./content-inputs.js", () => ({materializeFileBytes: async () => Uint8Array.of(1)}));
vi.mock("../nxengine/project.js", () => ({loadProject: async () => []}));
vi.mock("../px68k/files.js", () => ({fetchFile: async () => Uint8Array.of(1)}));
vi.mock("../gbe-pokemini/files.js", () => ({fetchFile: async () => Uint8Array.of(1)}));
vi.mock("../np2kai/content.js", () => ({loadDisk: async () => Uint8Array.of(1)}));

const identity = {sizeBytes: 1, sha256: "a".repeat(64)};
const paths = ["tic80/tic80-retrom", "fake08/fake08-retrom", "nxengine/nxengine-retrom", "px68k/px68k-retrom",
  "gbe_plus/gbe-pokemini", "np2kai/np2kai"].flatMap(name => [name + ".mjs", name + ".wasm"]);
const assetIndex = Object.fromEntries([...paths, "np2kai/font.bmp"].map(path => ["assets/" + path, identity]));
const common = {assetIndex, runtimeBaseUrl: "/provider/", contentDigest: identity.sha256};
const session = {} as AdapterContentSession;
const canvas = document.createElement("canvas");
const calls = [
  ...["tic80", "fake08"].map(core => ({name: core, file: core + "-retrom.wasm", load: () => fantasy({...common,
    core: core as "tic80" | "fake08", cartUrl: "/game", cartSizeBytes: 1}, () => {}, undefined, async () => {}, session)})),
  {name: "nxengine", file: "nxengine-retrom.wasm", load: () => nxengine({...common, projectIndexUrl: "/index.json"}, () => {}, undefined, undefined, session)},
  {name: "px68k", file: "px68k-retrom.wasm", load: () => px68k({...common, game: {...identity, url: "/disk.dim"},
    bios: ["iplrom.dat", "cgrom.dat"].map(logicalName => ({...identity, logicalName, url: "/" + logicalName}))}, () => {}, undefined, undefined, session)},
  {name: "gbe", file: "gbe-pokemini.wasm", load: () => gbe({...common, game: {...identity, url: "/cart.min"}, bios: []}, window, canvas, undefined, session)},
  {name: "np2kai", file: "np2kai.wasm", load: () => np2kai(common, window, canvas, undefined, session)},
];

it.each(calls)("$name resolves Wasm even when its verified module has a blob import.meta.url", async ({file, load}) => {
  factory.mockImplementation(async (options: {wasmBinary: Uint8Array; locateFile?: (file: string) => string}) => {
    // Emscripten resolves the filename before checking the supplied wasmBinary.
    const url = options.locateFile ? options.locateFile(file) : new URL(file, "blob:https://example.test/module").href;
    expect(new URL(url).pathname).toContain(file);
    expect(options.wasmBinary).toEqual(Uint8Array.of(1));
    throw new Error("VERIFIED_WASM_FACTORY_REACHED");
  });
  await expect(load()).rejects.toThrow("VERIFIED_WASM_FACTORY_REACHED");
});
