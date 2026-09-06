import {createHash} from "node:crypto";
import {zipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {unpackJ2meRelease} from "../scripts/j2me-release.mjs";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture(extra: Record<string, Uint8Array> = {}) {
  const filenames = ["j2me-runtime.js", "runtime-loader.js", "runtime.js", "runtime.wasm", "runtime.data",
    "runtime.worker.js", "audio-transcoder.wasm", "audio-transcoder.worker.js", "THIRD_PARTY_NOTICES.md"];
  const files = Object.fromEntries(filenames.map((name) => [name, new Uint8Array([1, 2])]));
  const archive = zipSync({...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`runtime/${name}`, bytes])), ...extra});
  const release = {id: "j2me", repository: "https://github.com/retrom-project/j2me-web",
    metadataRepository: "https://github.com/xxxsen/j2me-web", tag: "v0.3.3", commit: "a".repeat(40), adapterAbi: "j2me-rms",
    metadataUrl: "https://github.com/retrom-project/j2me-web/releases/download/v0.3.3/j2me-runtime-release.json",
    archive: {format: "zip", filename: "runtime.zip", rootDirectory: "runtime", sizeBytes: archive.length, sha256: sha(archive)},
    assets: filenames.map((filename) => ({filename, maxSizeBytes: 100}))};
  const metadata = {schemaVersion: 2, repository: release.metadataRepository, tag: release.tag,
    commit: release.commit, adapterAbi: release.adapterAbi,
    artifact: {...release.archive, observedSha256: release.archive.sha256},
    assets: filenames.slice(0, 8).map((filename) => ({filename, sizeBytes: 2, observedSha256: sha(files[filename])}))};
  return {release, metadata, archive};
}

describe("J2ME immutable ZIP release", () => {
  it("validates transferred repository provenance and extracts all runtime bytes plus notices", () => {
    const f = fixture();
    expect(unpackJ2meRelease(f.release, f.metadata, f.archive).size).toBe(9);
  });
  it("rejects mutated archive, asset hashes, and metadata identity", () => {
    const f = fixture();
    expect(() => unpackJ2meRelease(f.release, {...f.metadata, commit: "b".repeat(40)}, f.archive)).toThrow();
    expect(() => unpackJ2meRelease(f.release, f.metadata, f.archive.slice(1))).toThrow();
    f.metadata.assets[0].observedSha256 = "0".repeat(64);
    expect(() => unpackJ2meRelease(f.release, f.metadata, f.archive)).toThrow("J2ME_RELEASE_ASSET_INVALID");
  });
  it("rejects traversal in a correctly hashed archive", () => {
    const f = fixture({"runtime/../../escaped": new Uint8Array([1])});
    expect(() => unpackJ2meRelease(f.release, f.metadata, f.archive)).toThrow("J2ME_RELEASE_ARCHIVE_INVALID");
  });
});
