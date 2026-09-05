// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildProviderClient } from "../scripts/provider-client-build.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {force: true, recursive: true})));
});

describe("Provider client module build", () => {
  it("emits one deterministic self-contained ESM module", async () => {
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const entryPoint = join(process.cwd(), "src/providers/retrom-runtime/module.ts");
    const first = await buildProviderClient({
      assetIndex: {},
      entryPoint,
      outfile: join(firstRoot, "client.mjs"),
    });
    const second = await buildProviderClient({
      assetIndex: {},
      entryPoint,
      outfile: join(secondRoot, "client.mjs"),
    });
    const firstBytes = await readFile(first.outfile);
    const secondBytes = await readFile(second.outfile);
    expect(firstBytes).toEqual(secondBytes);
    expect(first.outputCount).toBe(1);
    expect(first.externalImports).toEqual([]);
    expect(firstBytes.toString("utf8")).toContain("providerApiVersion");
  });

  it.each([
    ["emulatorjs", "src/providers/emulatorjs/module.ts"],
    ["retrom-runtime", "src/providers/retrom-runtime/module.ts"],
  ] as const)("imports the built %s client as a closed browser module", async (providerId, entry) => {
    const root = await temporaryRoot();
    const result = await buildProviderClient({
      assetIndex: {},
      entryPoint: join(process.cwd(), entry),
      outfile: join(root, "client.mjs"),
    });
    const bytes = await readFile(result.outfile);
    const source = bytes.toString("utf8");
    expect(source).not.toMatch(/\b(?:Buffer|process|require)\b/u);
    const module = await import(`data:text/javascript;base64,${bytes.toString("base64")}`) as Record<string, unknown>;
    expect(Object.keys(module).sort()).toEqual([
      "createRuntime", "providerApiVersion", "providerId", "providerVersion",
    ]);
    expect(module.providerId).toBe(providerId);
    expect(module.providerApiVersion).toBe(1);
    expect(module.createRuntime).toBeTypeOf("function");
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "retrom-provider-client-"));
  temporaryRoots.push(root);
  return root;
}
