import {build} from "esbuild";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {argumentsFor, main} from "./cli.mjs";

/** Acceptance inventory only: the Host launch contract does not expose Provider-private policies. */
export async function targetCatalog() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const built = await build({stdin: {contents: `
    import {retromRuntimeProviderDefinition as runtime} from './src/providers/retrom-runtime/catalog.ts';
    import {emulatorJsProviderDefinition as ejs} from './src/providers/emulatorjs/catalog.ts';
    export default [runtime, ejs];`, resolveDir: root}, bundle: true, write: false, format: "esm", platform: "node"});
  const {default: providers} = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`);
  const targets = providers.flatMap(provider => provider.targets.map(target => ({
    providerId: provider.providerId, targetId: target.id, mode: target.contentIO.game.mode,
    delivery: target.contentIO.game.result ?? null, gameKind: target.inputs.find(input => input.role === "game").kind,
    checkpointSemantics: checkpointSemantics(provider, target),
  }))).sort((a, b) => `${a.providerId}/${a.targetId}`.localeCompare(`${b.providerId}/${b.targetId}`, "en"));
  return {schemaVersion: 1, targets};
}
function checkpointSemantics(provider, target) {
  const adapter = provider.adapters.find(adapter => adapter.id === target.adapterId);
  return adapter.checkpoint === null ? "NO_SAVE" : adapter.checkpoint.semantics ?? "INSTANT";
}

async function cli() {
  const args = argumentsFor({output: {type: "string"}, check: {type: "string"}}, []);
  if (args.help) {console.log("target-catalog [--output <acceptance inventory.json> | --check <inventory.json>]"); return;}
  const value = await targetCatalog(), text = JSON.stringify(value, null, 2) + "\n";
  if (args.check && JSON.stringify(JSON.parse(await readFile(args.check, "utf8"))) !== JSON.stringify(value)) {
    throw new Error("CONTENT_IO_TARGET_CATALOG_DRIFT");
  }
  if (args.output) {await writeFile(args.output, text);} else if (!args.check) {process.stdout.write(text);}
}
main(import.meta.url, cli);
