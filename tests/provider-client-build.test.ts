import ts from "typescript";
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
  ] as const)("[PK-01] CONTRACT/client-%s imports the built client with exactly four public exports", async (providerId, entry) => {
    const root = await temporaryRoot();
    const result = await buildProviderClient({
      assetIndex: {},
      entryPoint: join(process.cwd(), entry),
      outfile: join(root, "client.mjs"),
    });
    const bytes = await readFile(result.outfile);
    const source = bytes.toString("utf8");
    // Hash implementations may have a process() method; reject Node globals, not method names.
    const identifiers:string[]=[];
    const scan=(node:ts.Node)=>{if(ts.isIdentifier(node) && ["Buffer","require","process"].includes(node.text) && !((ts.isPropertyAccessExpression(node.parent)||ts.isMethodDeclaration(node.parent))&&node.parent.name===node)){identifiers.push(node.text);}ts.forEachChild(node,scan);};
    scan(ts.createSourceFile("client.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS));
    expect(identifiers).toEqual([]);
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
