import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {buildProviderBundle, providerMediaType, verifyProviderBundle} from "../scripts/provider-bundle.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {force: true, recursive: true})));
});

describe("deterministic provider bundle", () => {
  it("uses the complete V1 closed media-type allowlist", () => {
    expect([
      ["asset.css", "text/css; charset=utf-8"], ["asset.7z", "application/x-7z-compressed"],
      ["asset.png", "image/png"], ["asset.jpg", "image/jpeg"], ["asset.gif", "image/gif"],
      ["asset.webp", "image/webp"], ["asset.svg", "image/svg+xml"], ["asset.ico", "image/x-icon"],
      ["asset.ogg", "audio/ogg"], ["asset.mp3", "audio/mpeg"], ["asset.wav", "audio/wav"],
      ["asset.woff", "font/woff"], ["asset.woff2", "font/woff2"],
    ].map(([path, expected]) => providerMediaType(path) === expected)).toEqual(Array(13).fill(true));
  });

  it("registers every file and emits identical archives for identical inputs", async () => {
    const root = await temporaryRoot();
    const asset = join(root, "source/core.wasm");
    const license = join(root, "source/LICENSE");
    await mkdir(join(root, "source"), {recursive: true});
    await writeFile(asset, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    await writeFile(license, "fixture license\n");

    const first = await build(root, "first", asset, license);
    const second = await build(root, "second", asset, license);
    expect(first.bundleSha256).toBe(second.bundleSha256);
    expect(await readFile(first.archivePath)).toEqual(await readFile(second.archivePath));
    await verifyProviderBundle(first.bundleRoot);

    const integrity = JSON.parse(await readFile(join(first.bundleRoot, "integrity.json"), "utf8")) as {
      schemaVersion: number;
      files: Array<{path: string; sizeBytes: number; sha256: string; mediaType: string}>;
    };
    expect(integrity.schemaVersion).toBe(1);
    expect(integrity.files.map((entry) => entry.path)).toEqual([
      "assets/fixture/core.wasm",
      "client.mjs",
      "licenses/fixture/LICENSE",
      "provenance.json",
      "provider.json",
    ]);
    for (const entry of integrity.files) {
      const bytes = await readFile(join(first.bundleRoot, entry.path));
      expect(bytes.byteLength).toBe(entry.sizeBytes);
      expect(sha256(bytes)).toBe(entry.sha256);
    }
  });

  it("rejects changed and unregistered bundle entries", async () => {
    const root = await temporaryRoot();
    const asset = join(root, "core.wasm");
    const license = join(root, "LICENSE");
    await writeFile(asset, new Uint8Array([0, 97, 115, 109]));
    await writeFile(license, "fixture license\n");
    const result = await build(root, "tamper", asset, license);

    await writeFile(join(result.bundleRoot, "client.mjs"), "export const changed = true;\n");
    await expect(verifyProviderBundle(result.bundleRoot)).rejects.toThrow("PROVIDER_INTEGRITY_INVALID");

    const clean = await build(root, "symlink", asset, license);
    await symlink("client.mjs", join(clean.bundleRoot, "unregistered.mjs"));
    await expect(verifyProviderBundle(clean.bundleRoot)).rejects.toThrow("PROVIDER_BUNDLE_UNSAFE");
  });
});

async function build(root: string, name: string, asset: string, license: string) {
  return buildProviderBundle({
    archiveRoot: join(root, `${name}-archives`),
    assetSources: new Map([["assets/fixture/core.wasm", asset]]),
    bundleRoot: join(root, name),
    clientModuleBytes: new TextEncoder().encode([
      'export const providerId = "fixture";',
      'export const providerVersion = "1.0.0";',
      "export const providerApiVersion = 1;",
      "export function validateLaunchRequest(value) { return value; }",
      "export async function createRuntime() { throw new Error('fixture'); }",
      "",
    ].join("\n")),
    licenseSources: new Map([["licenses/fixture/LICENSE", license]]),
    manifest: fixtureManifest(),
    provenance: {
      adapters: [{abi: "fixture-v1", id: "fixture", kind: "FIXTURE"}],
      build: {tool: "provider-bundle-test", version: "1"},
      schemaVersion: 1,
      source: {commit: "a".repeat(40), repository: "https://example.invalid/fixture", tag: "v1.0.0"},
    },
  });
}

function fixtureManifest() {
  return {
    clientModulePath: "client.mjs" as const,
    providerApiVersion: 1 as const,
    providerId: "fixture",
    providerVersion: "1.0.0",
    schemaVersion: 1 as const,
    targets: [{
      assetPaths: ["assets/fixture/core.wasm"],
      capabilities: {
        checkpoint: false,
        frameCounter: false,
        frameMode: "NONE",
        pause: false,
        requiresThreads: false,
        screenshot: false,
        standardGamepad: false,
        validationProbes: [],
        volume: false,
      },
      checkpoint: null,
      displayName: "Fixture",
      id: "fixture",
      inputs: [{cardinality: "ONE", kind: "ROM_BLOB", optional: false, role: "game"}],
      targetOptionsSchema: {
        additionalProperties: false as const, properties: {}, required: [], type: "object" as const,
      },
    }],
  };
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "retrom-provider-bundle-"));
  temporaryRoots.push(root);
  return root;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
