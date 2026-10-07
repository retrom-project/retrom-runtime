import {configureHostInput, prepareHostInput, parentArchive, assembleResource, detectScummvm, arcadeTables, identifyHostBIOS,
  discoverContentDependencies, contentHostBIOSRequirements, hostDOSEntryCandidates, hostArcadeParentOptions} from "./runtime-host-input.mjs";
import {normalizeContent} from "./runtime-normalize-content.mjs";
import {readFile} from "node:fs/promises";
import {once} from "node:events";
import {runtimeCatalog, prepareRuntime, contentHash, restorability,
  inspectRuntimeIdentity, configureRuntime, arcadeBIOSRequirements, biosCatalog, resolveBIOSRequirements} from "../dist/runtime/index.js";

const maximumMessage = 64 * 1024 * 1024;
let catalog;

async function execute(command, input) {
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
  case "detect-scummvm": output = await detectScummvm(input); break;
  case "normalize-content": output = await normalizeContent(input); break;
  case "discover-content": output = await discoverContentDependencies(input); break;
  case "dos-entry-candidates": output = await hostDOSEntryCandidates(input); break;
  case "arcade-parents": output = await hostArcadeParentOptions(input); break;
  case "configure": output = configureRuntime(await configureHostInput(input)); break;
  case "prepare": output = prepareRuntime(await prepareHostInput(input)); break;
  case "parent-archive": output = await parentArchive(input); break;
  case "assemble-resource": output = await assembleResource(input); break;
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
        output.push({biosRequirements: [], error: error instanceof Error && /^RUNTIME_[A-Z0-9_]+$/u.test(error.message)
          ? error.message : "RUNTIME_CONTENT_UNAVAILABLE"});
      }
    }
    break;
  }
  case "bios-identify": output = await identifyHostBIOS(input); break;
  default: throw new Error("RUNTIME_COMMAND_INVALID");
  }
  return output;
}

function failure(error) {return error instanceof Error ? error.message : "RUNTIME_REQUEST_FAILED";}
function parentFailureDetails(error) {return error?.message === "RUNTIME_PARENT_MISSING" ? error.details : undefined;}

async function write(value) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maximumMessage) {throw new Error("RUNTIME_RESPONSE_TOO_LARGE");}
  if (!process.stdout.write(`${encoded}\n`)) {await once(process.stdout, "drain");}
}

async function* messages() {
  let length = 0, chunks = [];
  for await (const chunk of process.stdin) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      length += part.length;
      if (length > maximumMessage) {throw new Error("RUNTIME_REQUEST_TOO_LARGE");}
      chunks.push(part);
      if (newline === -1) {break;}
      yield Buffer.concat(chunks, length).toString("utf8");
      length = 0; chunks = []; start = newline + 1;
    }
  }
  if (length) {yield Buffer.concat(chunks, length).toString("utf8");}
}

function validId(id) {
  return typeof id === "string" ? /^[!-~]{1,128}$/.test(id) : Number.isSafeInteger(id) && id >= 0;
}

async function serve() {
  for await (const line of messages()) {
    let id = null;
    try {
      const request = JSON.parse(line);
      if (request && validId(request.id)) {id = request.id;}
      if (!request || Object.keys(request).length !== 3 || id === null ||
          typeof request.command !== "string" || !/^[a-z][a-z-]{0,63}$/.test(request.command) ||
          !request.input || typeof request.input !== "object" || Array.isArray(request.input)) {
        throw new Error("RUNTIME_REQUEST_INVALID");
      }
      await write({id, result: await execute(request.command, request.input)});
    } catch (error) {await write({id, error: failure(error), errorDetails: parentFailureDetails(error)});}
  }
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
  if (process.argv[2] === "--serve") {await serve();} else {await single();}
} catch (error) {
  await write(process.argv[2] === "--serve" ? {id: null, error: failure(error), errorDetails: parentFailureDetails(error)}
    : {error: failure(error), errorDetails: parentFailureDetails(error)});
  process.exitCode = 1;
}
