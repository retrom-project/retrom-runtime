import {configureHostInput, prepareHostInput, assembleResource, detectScummvm, arcadeTables, identifyHostBIOS,
  flycastConfigureEvidence, discoverContentDependencies, contentHostBIOSRequirements, hostDOSEntryCandidates, hostArcadeParentOptions} from "./runtime-host-input.mjs";
import {normalizeContent} from "./runtime-normalize-content.mjs";
import {readFile} from "node:fs/promises";
import {once} from "node:events";
import {serveJSONL} from "./runtime-jsonl.mjs";
import {runtimeCatalog, prepareRuntime, contentHash, restorability,
  inspectRuntimeIdentity, configureRuntime, arcadeBIOSRequirements, biosCatalog, resolveBIOSRequirements,
  arcadeROMSetOptions, reconcileArcadeConfiguration} from "../dist/runtime/index.js";

const maximumMessage = 64 * 1024 * 1024;
const {AbortController} = globalThis;
let catalog;

async function execute(command, input, signal = new AbortController().signal) {
  signal.throwIfAborted();
  let output;
  switch (command) {
  case "catalog": {
    catalog ??= (async () => {
      const tables = await arcadeTables();
      const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      return {...runtimeCatalog(metadata.version), biosRequirements: [...biosCatalog(), ...Object.entries(tables).flatMap(([core, games]) => arcadeBIOSRequirements(core, games))]};
    })();
    output = await catalog; break;
  }
  case "detect-scummvm": output = await detectScummvm(input, signal); break;
  case "normalize-content": output = await normalizeContent(input, signal); break;
  case "discover-content": output = await discoverContentDependencies(input); break;
  case "dos-entry-candidates": output = await hostDOSEntryCandidates(input); break;
  case "arcade-parents": output = await hostArcadeParentOptions(input); break;
  case "rom-sets": output = arcadeROMSetOptions({...input, arcadeCatalog: (await arcadeTables())[input.coreId]}); break;
  case "reconcile-config": output = reconcileArcadeConfiguration({...input, arcadeCatalogs: await arcadeTables(),
    ...await flycastConfigureEvidence({platformId: input.directory.platformId, coreIds: Object.keys(input.config?.cores ?? {}), providerRoots: input.providerRoots})}); break;
  case "configure": output = configureRuntime(await configureHostInput(input)); break;
  case "prepare": output = prepareRuntime(await prepareHostInput(input)); break;
  case "assemble-resource": output = await assembleResource(input, signal); break;
  case "hash": output = {romHash: contentHash(input.files, input.mode)}; break;
  case "restorable": output = restorability(input); break;
  case "batch-identity": {
    if (!Array.isArray(input.items) || input.items.length > 10000) {throw new Error("RUNTIME_REQUEST_TOO_LARGE");}
    output = input.items.map(item => {try {return inspectRuntimeIdentity(item);} catch (error) {return {error: error.message};}}); break;
  }
  case "batch-restorable": {
    if (!Array.isArray(input.items) || input.items.length > 10000) {throw new Error("RUNTIME_REQUEST_TOO_LARGE");}
    output = input.items.map(restorability); break;
  }
  case "bios-requirements": output = resolveBIOSRequirements(input); break;
  case "batch-content-bios-requirements": {
    if (!Array.isArray(input.items) || input.items.length > 100) {throw new Error("RUNTIME_REQUEST_TOO_LARGE");}
    output = [];
    for (const item of input.items) {
      try {output.push({...await contentHostBIOSRequirements(item), error: null});}
      catch (error) {
        output.push({biosRequirements: [], crcWarnings: [], missingRomMembers: [], error: error instanceof Error && /^RUNTIME_[A-Z0-9_]+$/u.test(error.message)
          ? error.message : "RUNTIME_CONTENT_UNAVAILABLE"});
      }
    }
    break;
  }
  case "bios-identify": output = await identifyHostBIOS(input); break;
  default: throw new Error("RUNTIME_COMMAND_INVALID");
  }
  signal.throwIfAborted();
  return output;
}

function failure(error) {return error instanceof Error ? error.message : "RUNTIME_REQUEST_FAILED";}
function parentFailureDetails(error) {return error?.message === "RUNTIME_PARENT_MISSING" ? error.details : undefined;}

async function write(value) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maximumMessage) {throw new Error("RUNTIME_RESPONSE_TOO_LARGE");}
  if (!process.stdout.write(`${encoded}\n`)) {await once(process.stdout, "drain");}
}

async function single() {
  let length = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    length += chunk.byteLength;
    if (length > maximumMessage) {throw new Error("RUNTIME_REQUEST_TOO_LARGE");}
    chunks.push(chunk);
  }
  const input = length ? JSON.parse(Buffer.concat(chunks, length).toString("utf8")) : {};
  await write(await execute(process.argv[2], input));
}

try {
  if (process.argv[2] === "--serve") {await serveJSONL(execute);} else {await single();}
} catch (error) {
  await write(process.argv[2] === "--serve" ? {id: null, error: failure(error), errorDetails: parentFailureDetails(error)}
    : {error: failure(error), errorDetails: parentFailureDetails(error)});
  process.exitCode = 1;
}
