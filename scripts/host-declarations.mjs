import {readFile, writeFile} from "node:fs/promises";
import {runtimeProviders} from "../dist/runtime/catalog.js";
import {projectProviderManifest} from "../dist/provider/manifest.js";

// The Go host embeds this projection; src/providers/*/catalog.ts stays the only declaration source.
const output = new URL("../host/facts/declarations.json", import.meta.url);
const argumentsList = process.argv.slice(2);
if (argumentsList.some(argument => argument !== "--check")) {
  throw new Error("Usage: node scripts/host-declarations.mjs [--check]");
}

export function hostDeclarations() {
  return {
    schemaVersion: 1,
    providers: runtimeProviders.map(provider => ({
      manifest: projectProviderManifest(provider),
      targets: Object.fromEntries(provider.targets.map(target => [target.id, {
        adapterId: target.adapterId,
        ...(target.romSetSelection ? {romSetSelection: target.romSetSelection} : {}),
      }])),
    })),
  };
}

const document = `${JSON.stringify(hostDeclarations(), null, 1)}\n`;
if (argumentsList.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== document) {
    throw new Error("host/facts/declarations.json is stale; run npm run host:declarations");
  }
} else {
  await writeFile(output, document);
}
