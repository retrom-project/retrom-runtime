import {lstat, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {loadProviderSources} from "./provider-sources.mjs";
import {unpackPinnedCoreArchive} from "./core-candidate-archive.mjs";
import {stageCoreDevelopmentInput} from "./core-development-input.mjs";

export async function prepareCoreCandidates({sources, archiveRoot, baseUrl, outputRoot}) {
  if ((!archiveRoot === !baseUrl) || !outputRoot) {throw new Error("CORE_CANDIDATE_TRANSPORT_REQUIRED");}
  const inputs = sources.developmentInputs.filter(source => source.candidateArchive);
  if (!inputs.length) {throw new Error("CORE_CANDIDATE_INPUT_REQUIRED");}
  let base;
  if (baseUrl) {
    base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      throw new Error("CORE_CANDIDATE_TRANSPORT_INVALID");
    }
  }
  await mkdir(outputRoot, {recursive: false});
  const overrides = {};
  for (const source of inputs) {
    let bytes;
    if (archiveRoot) {
      const path = join(archiveRoot, source.candidateArchive.filename), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== source.candidateArchive.sizeBytes) {
        throw new Error("CORE_CANDIDATE_ARCHIVE_INVALID");
      }
      bytes = await readFile(path);
    }
    else {
      const response = await fetch(new URL(source.candidateArchive.filename, base), {signal: globalThis.AbortSignal.timeout(60000)});
      if (!response.ok || new URL(response.url).protocol !== "https:") {throw new Error("CORE_CANDIDATE_DOWNLOAD_FAILED");}
      bytes = await boundedResponse(response, source.candidateArchive.sizeBytes);
    }
    const files = unpackPinnedCoreArchive(source, bytes), inputRoot = join(outputRoot, source.id);
    await mkdir(inputRoot);
    for (const [name, data] of Object.entries(files)) {await writeFile(join(inputRoot, name), data, {flag: "wx"});}
    const validationRoot = join(outputRoot, `.verify-${source.id}`);
    await stageCoreDevelopmentInput(source, inputRoot, pathToFileURL(`${validationRoot}/`));
    await rm(validationRoot, {recursive: true, force: true});
    overrides[source.id] = inputRoot;
  }
  return overrides;
}

async function boundedResponse(response, expected) {
  const reader = response.body?.getReader();
  if (!reader) {throw new Error("CORE_CANDIDATE_DOWNLOAD_FAILED");}
  const chunks = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) {break;}
    size += value.length;
    if (size > expected) {await reader.cancel(); throw new Error("CORE_CANDIDATE_ARCHIVE_INVALID");}
    chunks.push(value);
  }
  if (size !== expected) {throw new Error("CORE_CANDIDATE_ARCHIVE_INVALID");}
  return Buffer.concat(chunks);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, transport, flag, destination] = process.argv.slice(2);
  if (!["--archive-root", "--base-url"].includes(mode) || flag !== "--output" || !destination ||
    process.argv.length !== 6 || !transport) {throw new Error("CORE_CANDIDATE_TRANSPORT_REQUIRED");}
  const sources = await loadProviderSources(new URL("../", import.meta.url));
  const overrides = await prepareCoreCandidates({sources, outputRoot: resolve(destination),
    ...mode === "--archive-root" ? {archiveRoot: resolve(transport)} : {baseUrl: transport}});
  process.stdout.write(`RETROM_RUNTIME_DEV_RELEASE_OVERRIDES=${JSON.stringify(overrides)}\n`);
}
