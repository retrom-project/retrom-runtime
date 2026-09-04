// @vitest-environment node

import {readFile, readdir} from "node:fs/promises";
import {describe, expect, it} from "vitest";

import {parseLaunchEnvelopeJSON, validateLaunchEnvelopeBoundary} from "../src/provider/module-api.js";
import {projectProviderManifest} from "../src/provider/manifest.js";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";

const forbiddenBusinessIdentityFields = [
  "gameCompatibilityLine",
  "gameVariantRevisionId",
  "netplayCompatibilityLine",
  "targetContractSha256",
] as const;

describe("current Provider protocol", () => {
  it("keeps production protocol artifacts free of removed business identities", async () => {
    const artifacts = [
      "contracts/retrom-provider/v1/launch-envelope.schema.json",
      "contracts/retrom-provider/v1/provider-manifest.schema.json",
      "contracts/retrom-provider/v1/provider-module-v1.d.ts",
      "src/provider/contract.ts",
      "src/provider/declarations.ts",
      "src/provider/generated/provider-module-v1.ts",
      "src/provider/manifest.ts",
      "src/provider/module-api.ts",
      "src/providers/emulatorjs/catalog.ts",
      "src/providers/emulatorjs/module.ts",
      "src/providers/emulatorjs/netplay-profile.ts",
      "src/providers/retrom-runtime/catalog.ts",
      "src/providers/retrom-runtime/module-config.ts",
      "src/providers/retrom-runtime/module.ts",
    ];
    const fixtureRoot = "contracts/retrom-provider/v1/fixtures";
    artifacts.push(...(await readdir(fixtureRoot, {recursive: true}))
      .filter((path) => path.endsWith(".json"))
      .map((path) => `${fixtureRoot}/${path}`));
    const source = (await Promise.all(artifacts.map((path) => readFile(path, "utf8")))).join("\n");
    for (const field of forbiddenBusinessIdentityFields) {
      expect(source, field).not.toContain(field);
    }
  });

  it("uses providerId plus targetId as the complete stable Target identity", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition) as unknown as Record<string, unknown>;
    const source = JSON.stringify(manifest);
    for (const field of forbiddenBusinessIdentityFields) {
      expect(source).not.toContain(`"${field}"`);
    }
  });

  it("accepts a Launch Envelope without generated Target contract identity", async () => {
    const fixture = JSON.parse(await readFile(
      "contracts/retrom-provider/v1/fixtures/valid/single-minimal.json", "utf8",
    )) as {runtime: Record<string, unknown>};
    delete fixture.runtime.gameCompatibilityLine;
    delete fixture.runtime.targetContractSha256;
    expect(() => parseLaunchEnvelopeJSON(JSON.stringify(fixture))).not.toThrow();
  });

  it("rejects removed compatibility fields instead of accepting a legacy facade", async () => {
    const fixture = JSON.parse(await readFile(
      "contracts/retrom-provider/v1/fixtures/valid/single-minimal.json", "utf8",
    )) as {runtime: Record<string, unknown>};
    fixture.runtime.gameCompatibilityLine = "fixture-v1";
    fixture.runtime.targetContractSha256 = "c".repeat(64);
    expect(() => validateLaunchEnvelopeBoundary(fixture))
      .toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });
});
