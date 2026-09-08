import {readFile} from "node:fs/promises";
import {zipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {assertScummvmCandidateMode, scummvmOutput, unpackScummvmCandidate, validateScummvmLayout} from "../scripts/scummvm-release.mjs";
import {sha256} from "../scripts/provider-sources.mjs";
import {unpackScummvmRelease, validScummvmRelease} from "../scripts/scummvm-published-release.mjs";

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
    sources.upstreamReleases = sources.upstreamReleases.filter((entry: {id: string}) => entry.id !== "scummvm");
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

function publishedFixture() {
  const {entries, layout} = fixture(); const bytes = zipSync(entries);
  const release = {...source, tag: "retrom-core-2026.3.0-r1", commit: "a".repeat(40),
    metadataUrl: `${source.repository}/releases/download/retrom-core-2026.3.0-r1/rpg-runtime-release.json`,
    archive: {...source.archive, sha256: sha256(bytes), sizeBytes: bytes.length},
    assets: layout.files.map((file) => ({filename: file.path, output: scummvmOutput(file.path), maxSizeBytes: file.maxSizeBytes})),
  };
  const metadata = {schemaVersion: 1, repository: release.repository, tag: release.tag, commit: release.commit,
    adapterAbi: release.adapterAbi, digestPolicy: "OBSERVED_CACHE_INTEGRITY_ONLY", sourceCommits: {engine: source.upstreamCommit},
    assets: [{filename: release.archive.filename, sizeBytes: bytes.length, observedSha256: sha256(bytes)}]};
  return {release, metadata, bytes, layout, entries};
}

describe("published ScummVM core input", () => {
  it("accepts a fixed published ScummVM archive alongside existing released cores", async () => {
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
    const {release, metadata, bytes, layout, entries} = publishedFixture();
    delete sources.developmentInputs;
    sources.upstreamReleases = sources.upstreamReleases.filter((entry: {id: string}) => entry.id !== "scummvm");
    sources.upstreamReleases.push(release);
    expect(() => validateProviderSources(sources)).not.toThrow();
    expect([...unpackScummvmRelease(release, metadata, bytes, layout).keys()].sort()).toEqual(Object.keys(entries).sort());
  });
  it.each(["repository", "tag", "commit", "adapterAbi", "digestPolicy"])("rejects a mismatched metadata %s", (key) => {
    const {release, metadata, bytes, layout} = publishedFixture();
    expect(() => unpackScummvmRelease(release, {...metadata, [key]: "wrong"}, bytes, layout)).toThrow("SCUMMVM_RELEASE_IDENTITY_INVALID");
  });
  it("rejects upstream, archive identity and byte changes before extraction", () => {
    const {release, metadata, bytes, layout} = publishedFixture();
    for (const changed of [
      {...metadata, sourceCommits: {engine: "b".repeat(40)}},
      {...metadata, assets: [{...metadata.assets[0], filename: "other.zip"}]},
      {...metadata, assets: [{...metadata.assets[0], observedSha256: "b".repeat(64)}]},
      {...metadata, assets: [{...metadata.assets[0], sizeBytes: bytes.length + 1}]},
      {...metadata, assets: [...metadata.assets, metadata.assets[0]]},
    ]) {expect(() => unpackScummvmRelease(release, changed, bytes, layout)).toThrow("SCUMMVM_RELEASE_IDENTITY_INVALID");}
    const corrupt = bytes.slice(); corrupt[0] ^= 1;
    expect(() => unpackScummvmRelease(release, metadata, corrupt, layout)).toThrow("SCUMMVM_RELEASE_IDENTITY_INVALID");
    expect(() => unpackScummvmRelease(release, metadata, bytes.slice(1), layout)).toThrow("SCUMMVM_RELEASE_IDENTITY_INVALID");
  });
  it("requires an exact layout and rejects altered output paths or bounds", () => {
    const {release, metadata, bytes, layout} = publishedFixture();
    for (const assets of [release.assets.slice(1), [...release.assets].reverse(),
      release.assets.map((asset, i) => i === 0 ? {...asset, output: "runtime/another-core"} : asset),
      release.assets.map((asset, i) => i === 0 ? {...asset, maxSizeBytes: 4096} : asset),
    ]) {expect(() => unpackScummvmRelease({...release, assets}, metadata, bytes, layout)).toThrow("SCUMMVM_RELEASE_IDENTITY_INVALID");}
    const changed = {...release, archive: {...release.archive, sizeBytes: release.archive.maxSizeBytes + 1}};
    expect(validScummvmRelease(changed)).toBe(false);
  });
  it.each(["../escape", "plugins/libqueen.so"])("retains closed archive validation for a digest-pinned %s entry", (path) => {
    const {release, metadata, layout, entries} = publishedFixture();
    const bytes = zipSync({...entries, [path]: new Uint8Array([1])});
    release.archive.sizeBytes = bytes.length; release.archive.sha256 = sha256(bytes);
    metadata.assets[0].sizeBytes = bytes.length; metadata.assets[0].observedSha256 = sha256(bytes);
    expect(() => unpackScummvmRelease(release, metadata, bytes, layout)).toThrow("SCUMMVM_ARCHIVE_INVALID");
  });
});
