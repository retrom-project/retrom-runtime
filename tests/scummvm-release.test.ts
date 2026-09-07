import {readFile} from "node:fs/promises";
import {zipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {assertScummvmCandidateMode, unpackScummvmCandidate, validateScummvmLayout} from "../scripts/scummvm-release.mjs";
import {sha256} from "../scripts/provider-sources.mjs";

const source = {id: "scummvm", repository: "https://github.com/retrom-project/scummvm",
  upstreamCommit: "fed42f2068dcafc6aafa1c28c77e4c88def74b66", adapterAbi: "scummvm-host-v1",
  archive: {filename: "scummvm-runtime.zip", maxSizeBytes: 268435456, maxUnpackedSizeBytes: 805306368,
    layout: "src/scummvm/core-layout.json"}};
function fixture() {
  const files = {"scummvm.mjs": new Uint8Array([1]), "scummvm-retrom.mjs": new Uint8Array([2]),
    "scummvm.wasm": new Uint8Array([3]), "plugins/libsky.so": new Uint8Array([4]),
    "licenses/COPYING": new Uint8Array([5]), "native/linux-x86_64/scummvm-detector": new Uint8Array([6])};
  const manifest = {schemaVersion: 1, adapterAbi: source.adapterAbi, upstreamCommit: source.upstreamCommit,
    engines: {sky: "plugins/libsky.so"}, files: Object.entries(files).map(([path, bytes]) => ({path, sizeBytes: bytes.length, sha256: sha256(bytes)}))};
  const entries = {...files, "manifest.json": new TextEncoder().encode(JSON.stringify(manifest))};
  const layout = {schemaVersion: 1, engines: ["sky"], files: Object.keys(entries).sort().map((path) => ({path, maxSizeBytes: 2048}))};
  return {entries, layout};
}

describe("unpublished ScummVM core input", () => {
  it("accepts the complete checked-in core layout in canonical path order", async () => {
    const layout: unknown = JSON.parse(await readFile("src/scummvm/core-layout.json", "utf8"));
    const files = validateScummvmLayout(layout);
    expect(files.has("data/shaders.dat")).toBe(true);
    expect(files.has("data/shaders/wme_sprite.vertex")).toBe(true);
  });
  it("declares acquisition without inventing a release tag or adding target declarations", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    sources.developmentInputs = [structuredClone(source)];
    expect(() => validateProviderSources(sources)).not.toThrow();
    sources.developmentInputs[0].tag = "future";
    expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
  });
  it("requires an explicit PFB candidate and refuses release or ordinary builds", () => {
    expect(() => assertScummvmCandidateMode([source], true, false)).not.toThrow();
    expect(() => assertScummvmCandidateMode([source], false, false)).toThrow("UNPUBLISHED_CORE_INPUT");
    expect(() => assertScummvmCandidateMode([source], true, true)).toThrow("UNPUBLISHED_CORE_INPUT");
  });
  it("verifies the closed archive, plugin list, native tool and licenses", () => {
    const {entries, layout} = fixture();
    const files = unpackScummvmCandidate(source, layout, zipSync(entries));
    expect([...files.keys()].sort()).toEqual(Object.keys(entries).sort());
    entries["plugins/libsky.so"][0] = 9;
    expect(() => unpackScummvmCandidate(source, layout, zipSync(entries))).toThrow("SCUMMVM_ARCHIVE_INVALID");
  });
  it.each(["../escape", "plugins/libqueen.so", "data/unlisted"])("rejects the undeclared entry %s", (path) => {
    const {entries, layout} = fixture();
    expect(() => unpackScummvmCandidate(source, layout, zipSync({...entries, [path]: new Uint8Array([1])}))).toThrow("SCUMMVM_ARCHIVE_INVALID");
  });
  it("rejects expansion beyond the per-file cap before accepting the payload", () => {
    const {entries, layout} = fixture(); entries["scummvm.wasm"] = new Uint8Array(4096);
    expect(() => unpackScummvmCandidate(source, layout, zipSync(entries))).toThrow("SCUMMVM_ARCHIVE_INVALID");
  });
});
