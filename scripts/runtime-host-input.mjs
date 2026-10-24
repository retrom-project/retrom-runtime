import {openContent, readContent, contentStream} from "./runtime-host-content.mjs";
import {pipeline} from "node:stream/promises";
import {createWriteStream} from "node:fs";
import {createHash} from "node:crypto";
import {createReadStream, constants} from "node:fs";
import {open, readFile, mkdtemp, copyFile, chmod, rm, readdir, mkdir, stat} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {gunzipSync, crc32} from "node:zlib";
import {parseRuntimeConfiguration, contentHash, runtimeBindings, identifyPSXRegion, resolveSavedRuntimeRequest,
  contentBIOSRequirements, missingROMMember, dosEntryCandidates, arcadeParentOptions, resolveRuntimeTarget, flycastMachine, flycastContentReferences, flycastMedia,
  onsScriptNames, onsScriptSampleBytes, contentEntryExtensions, cueContentReferences, kirikiriArchiveProbeBytes} from "../dist/runtime/index.js";
import {zipMembers, requireLocator, safePath, sha256} from "./runtime-archive-input.mjs";
import {discoverMameMedia, mameMediaEvidence} from "./runtime-host-media.mjs";

export async function configureHostInput(input) {
  contentHash(input.files, "TREE");
  const evidence = {...input.evidence}, archiveMembers = {...input.archiveMembers};
  let onsSamples = 0;
  for (const file of input.files) {
    const name = file.logicalKey.split("/").at(-1).toLowerCase();
    if (input.platformId === "kirikiri" && file.sizeBytes >= kirikiriArchiveProbeBytes &&
      evidence[file.logicalKey]?.prefixBase64 === undefined && input.locators?.[file.logicalKey]) {
      const chunks = [];
      for await (const chunk of contentStream(requireLocator(input, file), {length: kirikiriArchiveProbeBytes})) {chunks.push(chunk);}
      evidence[file.logicalKey] = {...evidence[file.logicalKey], prefixBase64: Buffer.concat(chunks).toString("base64")};
    }
    const needsEvidence = input.platformId === "rpgmaker" && ["game.ini", "rpg_rt.ldb"].includes(name);
    if (needsEvidence && !evidence[file.logicalKey] && input.locators?.[file.logicalKey]) {
      const maximum = name === "game.ini" ? 262144 : 24 * 1024 * 1024;
      if (file.sizeBytes > maximum) {throw new Error("RUNTIME_EVIDENCE_TOO_LARGE");}
      const bytes = await readContent(requireLocator(input, file));
      if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      evidence[file.logicalKey] = name === "game.ini" ? {text: new TextDecoder().decode(bytes)} : {bytesBase64: bytes.toString("base64")};
    }
    if (input.platformId === "ons" && onsScriptNames.includes(file.logicalKey.split("/").at(-1)) && !evidence[file.logicalKey] &&
      input.locators?.[file.logicalKey]) {
      if (++onsSamples > 64) {throw new Error("RUNTIME_EVIDENCE_TOO_LARGE");}
      const chunks = [], length = Math.min(file.sizeBytes, onsScriptSampleBytes);
      for await (const chunk of contentStream(requireLocator(input, file), {length})) {chunks.push(chunk);}
      evidence[file.logicalKey] = {prefixBase64: Buffer.concat(chunks).toString("base64")};
    }
    if (input.platformId === "dos" && /\.(?:zip|dosz)$/u.test(name) && !archiveMembers[file.logicalKey] && input.locators?.[file.logicalKey]) {
      archiveMembers[file.logicalKey] = (await zipMembers(requireLocator(input, file))).map(member => member.name);
    }
  }
  const selection = input.platformId === "scummvm" && !input.selection?.scummvm
    ? {...input.selection, scummvm: await configureScummvm(input)} : input.selection;
  return {...input, evidence, archiveMembers, selection, ...(input.platformId === "arcade" ? {arcadeCatalogs: await arcadeTables()} : {}),
    ...await flycastConfigureEvidence(input)};
}

async function configureScummvm(input) {
  const binding = runtimeBindings.find(binding => binding.platformIds.includes(input.platformId) && input.coreIds.includes(binding.coreId));
  const providerRoot = input.providerRoots?.[binding?.providerId];
  if (typeof providerRoot !== "string" || !providerRoot.startsWith("/")) {throw new Error("RUNTIME_DETECTOR_UNAVAILABLE");}
  const treeRoot = await mkdtemp(join(tmpdir(), "retrom-runtime-configure-"));
  try {
    for (const file of input.files) {
      if (!safePath(file.logicalKey)) {throw new Error("RUNTIME_DETECTION_INPUT_INVALID");}
      const source = requireLocator(input, file);
      const destination = join(treeRoot, file.logicalKey); await mkdir(dirname(destination), {recursive: true});
      await pipeline(contentStream(source), createWriteStream(destination, {flags: "wx", mode: 0o600}));
      const hash = createHash("sha256"); for await (const bytes of createReadStream(destination)) {hash.update(bytes);}
      if (hash.digest("hex") !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    }
    const result = await detectScummvm({providerRoot, treeRoot});
    const selected = result.candidates.find(candidate => candidate.id === result.automaticSelection);
    if (!selected || selected.blocker !== null) {throw new Error("RUNTIME_SCUMMVM_SELECTION_REQUIRED");}
    return selected.options;
  } finally {await rm(treeRoot, {recursive: true, force: true});}
}

export async function prepareHostInput(input) {
  input = resolveSavedRuntimeRequest(input);
  const config = parseRuntimeConfiguration(input.config);
  if (config.content.kind === "DOS_BUNDLE" && config.content.entryPath !== undefined) {
    const file = input.files.find(item => item.logicalKey === config.content.entryFile);
    if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
    return {...input, dosEntries: (await zipMembers(requireLocator(input, file))).map(member => member.name)};
  }
  let prepared = input;
  if (config.content.kind === "SINGLE_FILE" && config.content.entryFile.toLowerCase().endsWith(".cue")) {
    prepared = {...input, cueFiles: await cueFiles(input, config.content.entryFile)};
  }
  const coreId = input.coreId ?? input.directory.defaultCoreId;
  prepared = await prepareFirmwareEvidence(prepared, config, coreId);
  const {target, binding} = resolveRuntimeTarget(input.directory.platformId, coreId, config.content);
  if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
    const file = input.files.find(item => item.logicalKey === config.content.entryFile);
    if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
    const facts = await flycastArchiveEvidence(input, config, coreId, binding, target);
    const machine = flycastMachine(target.contentRequirements.platform, file, facts.flycastCatalog);
    for (const key of flycastMedia(machine, file, input.files).mediaFiles) {await validateCHD(input, key);}
    return {...prepared, ...facts};
  }
  if (config.content.kind !== "ARCADE") {return prepared;}
  const tables = await arcadeTables();
  if (!tables[coreId]) {throw new Error("RUNTIME_ARCADE_CATALOG_UNAVAILABLE");}
  const keys = [config.content.entryFile, ...config.cores?.[coreId]?.parentFiles ?? []];
  const archives = {};
  for (const key of keys) {
    const file = input.files.find(item => item.logicalKey === key);
    if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
    archives[key] = await zipMembers(requireLocator(input, file));
  }
  return {...input, arcadeCatalog: tables[coreId], archives, ...await mameMediaEvidence(input, coreId)};
}

/** All host operations use the same paired table and original archive evidence. */
async function flycastArchiveEvidence(input, config, coreId, binding, target) {
  const archives = {}, keys = new Set([config.content.entryFile, ...config.cores?.[coreId]?.parentFiles ?? [],
    ...(input.attachFile?.toLowerCase().endsWith(".zip") ? [input.attachFile] : [])]);
  for (const key of keys) {
    const file = input.files.find(file => file.logicalKey === key);
    if (file) {archives[key] = await zipMembers(requireLocator(input, file));}
  }
  return {archives, flycastCatalog: await flycastTable(input.providerRoots?.[binding.providerId], target.contentRequirements)};
}
export async function flycastConfigureEvidence(input) {
  const flycastCatalogs = {};
  for (const coreId of input.coreIds ?? []) {
    if (!runtimeBindings.some(binding => binding.coreId === coreId && binding.platformIds.includes(input.platformId) &&
      binding.contentKinds.includes("SINGLE_FILE"))) {continue;}
    const {target, binding} = resolveRuntimeTarget(input.platformId, coreId, {kind: "SINGLE_FILE", entryFile: "content"});
    if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
      flycastCatalogs[coreId] = await flycastTable(input.providerRoots?.[binding.providerId], target.contentRequirements);
    }
  }
  return Object.keys(flycastCatalogs).length ? {flycastCatalogs} : {};
}
async function validateCHD(input, key) {
  const file = input.files.find(file => file.logicalKey === key);
  if (!file) {throw new Error("RUNTIME_FLYCAST_DISC_MISSING");}
  const handle = await openContent(requireLocator(input, file));
  try {
    const info = await handle.stat(), bytes = Buffer.alloc(124);
    if (!info.isFile() || info.size !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    const version = bytesRead >= 16 ? bytes.readUInt32BE(12) : 0;
    const minimum = ({3: 120, 4: 108, 5: 124})[version];
    if (!minimum || bytesRead < minimum || bytes.subarray(0, 8).toString("ascii") !== "MComprHD" ||
      bytes.readUInt32BE(8) !== minimum) {throw new Error("RUNTIME_FLYCAST_DISC_INVALID");}
  } finally {await handle.close();}
}

const flycastTables = new Map();
export async function flycastTable(root, requirement) {
  if (typeof root !== "string" || !root.startsWith("/")) {throw new Error("RUNTIME_FLYCAST_CATALOG_UNAVAILABLE");}
  const key = `${root}:${requirement.core.sha256}:${requirement.catalog.sha256}`;
  if (!flycastTables.has(key)) {flycastTables.set(key, loadFlycastTable(root, requirement));}
  return flycastTables.get(key);
}
async function loadFlycastTable(root, requirement) {
    const readAsset = async (reference, maximum) => {
      const handle = await open(join(root, reference.path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size < 1 || info.size > maximum) {throw new Error("RUNTIME_FLYCAST_CATALOG_INVALID");}
        const bytes = await handle.readFile();
        if (sha256(bytes) !== reference.sha256) {throw new Error("RUNTIME_FLYCAST_CATALOG_INVALID");}
        return bytes;
      } finally {await handle.close();}
    };
    // The selected Provider's ROM facts must belong to the exact core used for this Target.
    await readAsset(requirement.core, 32 * 1024 * 1024);
    const document = JSON.parse((await readAsset(requirement.catalog, 4 * 1024 * 1024)).toString("utf8"));
    if (document.schemaVersion !== 1 || document.kind !== "FLYCAST_ROM_REQUIREMENTS" ||
      document.core?.sha256 !== requirement.core.sha256 || document.core?.filename !== requirement.core.path.split("/").at(-1)) {
      throw new Error("RUNTIME_FLYCAST_CATALOG_INVALID");
    }
    const catalog = document.machines;
    if (!Array.isArray(catalog) || catalog.length > 10000 || catalog.some(machine =>
      typeof machine.name !== "string" || typeof machine.platform !== "string" || typeof machine.mediaType !== "string" ||
      machine.parent !== null && (typeof machine.parent !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(machine.parent) || machine.parent.includes("..")) ||
      machine.disc !== null && (typeof machine.disc !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(machine.disc) || machine.disc.includes("..")) ||
      !Array.isArray(machine.files) || machine.files.some(file => typeof file.name !== "string" ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || typeof file.optional !== "boolean" ||
        file.crc32 !== null && !/^[0-9a-f]{8}$/iu.test(file.crc32)))) {throw new Error("RUNTIME_FLYCAST_CATALOG_INVALID");}
    return catalog;
}

/** Read only evidence needed for BIOS rules; Parent and other launch resources remain unprepared. */
export async function contentHostBIOSRequirements(input) {
  contentHash(input.files, "TREE");
  const config = parseRuntimeConfiguration(input.config), coreId = input.coreId ?? input.directory.defaultCoreId;
  let prepared = await prepareFirmwareEvidence(input, config, coreId);
  if (config.content.kind === "ARCADE") {
    const tables = await arcadeTables();
    if (!tables[coreId]) {throw new Error("RUNTIME_ARCADE_CATALOG_UNAVAILABLE");}
    const file = input.files.find(file => file.logicalKey === config.content.entryFile);
    if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
    const archives = {[file.logicalKey]: await zipMembers(requireLocator(input, file))};
    for (const key of config.cores?.[coreId]?.parentFiles ?? []) {
      const parent = input.files.find(file => file.logicalKey === key);
      if (parent) {archives[key] = await zipMembers(requireLocator(input, parent));}
    }
    prepared = {...prepared, arcadeCatalog: tables[coreId], archives, ...await mameMediaEvidence(input, coreId)};
  }
  const {target, binding} = resolveRuntimeTarget(input.directory.platformId, coreId, config.content);
  if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
    const file = input.files.find(file => file.logicalKey === config.content.entryFile);
    if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
    const facts = await flycastArchiveEvidence(input, config, coreId, binding, target);
    const machine = flycastMachine(target.contentRequirements.platform, file, facts.flycastCatalog);
    for (const key of flycastMedia(machine, file, input.files).mediaFiles) {await validateCHD(input, key);}
    prepared = {...prepared, ...facts};
  }
  const result = contentBIOSRequirements(prepared);
  for (const requirement of result.biosRequirements) {
    const file = input.biosFiles?.find(file => file.requirementKey === requirement.requirementKey);
    if (!file || !requirement.members?.length) {continue;}
    const members = await biosMembers(file.path);
    for (const expected of requirement.members) {
      const missing = expected.required && missingROMMember(requirement.coreId, requirement.logicalName.replace(/\.zip$/iu, ""),
        "BIOS", {name: expected.name, size: String(expected.sizeBytes), crc: expected.crc32},
        matchesBIOSMember(members, expected) ? members : []);
      if (missing) {result.missingRomMembers.push(missing);}
      const member = members.find(member => member.sizeBytes === expected.sizeBytes && member.crc32 === expected.crc32) ??
        members.find(member => member.name === expected.name && member.sizeBytes === expected.sizeBytes);
      if (member && member.crc32 !== expected.crc32) {
        result.crcWarnings.push({role: "BIOS", file: file.filename, member: member.name,
          expectedCRC32: expected.crc32.toLowerCase(), actualCRC32: member.crc32.toLowerCase()});
      }
    }
  }
  return result;
}

/** List the current archive independently of an existing, possibly stale program selection. */
export async function hostDOSEntryCandidates(input) {
  contentHash(input.files, "TREE");
  const content = input.config?.content;
  const config = parseRuntimeConfiguration({content: {kind: content?.kind, entryFile: content?.entryFile}});
  if (config.content.kind !== "DOS_BUNDLE") {throw new Error("RUNTIME_CONFIGURATION_INVALID");}
  const file = input.files.find(file => file.logicalKey === config.content.entryFile);
  if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
  try {return {entries: dosEntryCandidates((await zipMembers(requireLocator(input, file))).map(member => member.name))};}
  catch (cause) {
    if (cause instanceof Error && /^RUNTIME_[A-Z0-9_]+$/u.test(cause.message)) {throw cause;}
    throw new Error("RUNTIME_CONTENT_UNAVAILABLE", {cause});
  }
}

/** Read current Parent archives and a proposed attachment using the same DAT authority. */
export async function hostArcadeParentOptions(input) {
  const config = parseRuntimeConfiguration(input.config), coreId = input.coreId ?? input.directory.defaultCoreId;
  const {target, binding} = resolveRuntimeTarget(input.directory.platformId, coreId, config.content);
  if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
    if (input.attachFile?.toLowerCase().endsWith(".chd")) {await validateCHD(input, input.attachFile);}
    return arcadeParentOptions({...input, ...await flycastArchiveEvidence(input, config, coreId, binding, target)});
  }
  if (config.content.kind !== "ARCADE") {throw new Error("RUNTIME_CONFIGURATION_INVALID");}
  const tables = await arcadeTables(), archives = {};
  const keys = new Set([config.content.entryFile, ...config.cores?.[coreId]?.parentFiles ?? [],
    ...(input.attachFile?.toLowerCase().endsWith(".zip") ? [input.attachFile] : [])]);
  for (const key of keys) {
    const file = input.files.find(item => item.logicalKey === key);
    if (file) {archives[key] = await zipMembers(requireLocator(input, file));}
  }
  return arcadeParentOptions({...input, archives, arcadeCatalog: tables[coreId], ...await mameMediaEvidence(input, coreId)});
}

async function prepareFirmwareEvidence(input, config, coreId) {
  if (coreId !== "mednafen_psx_hw" || config.content.kind !== "SINGLE_FILE") {return input;}
  if (config.content.entryFile.toLowerCase().endsWith(".cue") && !input.cueFiles) {
    input = {...input, cueFiles: await cueFiles(input, config.content.entryFile)};
  }
  return {...input, firmwareEvidence: {psxRegion: await psxRegion(input, config.content.entryFile)}};
}

/** The managed store already verified whole-file SHA; inspect only the disc system area. */
async function psxRegion(input, entry) {
  const key = entry.toLowerCase().endsWith(".cue") ? input.cueFiles?.[0] : entry;
  if (!key || !/\.(?:bin|iso|img)$/iu.test(key)) {return null;}
  const file = input.files.find(item => item.logicalKey === key);
  if (!file) {throw new Error("RUNTIME_ENTRY_MISSING");}
  const handle = await openContent(requireLocator(input, file));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    const bytes = Buffer.alloc(Math.min(info.size, 5 * 2352));
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    return identifyPSXRegion(bytes);
  } finally {await handle.close();}
}

async function cueFiles(input, entry) {
  const file = input.files.find(item => item.logicalKey === entry);
  const references = await cueReferences(input, file);
  return [...new Set(references.map(reference => {
    const matches = input.files.filter(item => item.logicalKey.toLowerCase() === reference.logicalKey.toLowerCase());
    if (matches.length !== 1) {throw new Error("RUNTIME_CUE_TRACK_MISSING");}
    return matches[0].logicalKey;
  }))];
}

/** Source discovery returns names; the Host authorizes and copies their actual bytes. */
export async function discoverContentDependencies(input) {
  contentHash(input.files, "TREE");
  const found = [];
  const directory = input.directory;
  if (directory && contentEntryExtensions(directory.platformId, directory.defaultCoreId).includes("cue")) {
    for (const file of input.files.filter(file => file.logicalKey.toLowerCase().endsWith(".cue"))) {
      found.push(...await cueReferences(input, file));
    }
  }
  if (directory?.platformId === "arcade" && directory.defaultCoreId === "mame_arcade") {
    const result = discoverMameMedia(input, (await arcadeTables()).mame_arcade);
    return {...result, files: [...found, ...result.files]};
  }
  if (directory && runtimeBindings.some(binding => binding.coreId === directory.defaultCoreId &&
    binding.platformIds.includes(directory.platformId) && binding.contentKinds.includes("SINGLE_FILE"))) {
    const {target, binding} = resolveRuntimeTarget(directory.platformId, directory.defaultCoreId, {kind: "SINGLE_FILE", entryFile: "content"});
    if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
      const catalog = await flycastTable(input.providerRoots?.[binding.providerId], target.contentRequirements);
      for (const file of input.files.filter(file => /\.zip$/iu.test(file.name))) {
        const name = file.name.split("/").at(-1).slice(0, -4).toLowerCase();
        const machine = catalog.find(machine => machine.name === name && machine.platform === directory.platformId);
        if (machine && ["CARTRIDGE", "GDROM"].includes(machine.mediaType)) {
          found.push(...flycastContentReferences(machine, file, await zipMembers(requireLocator(input, file)), catalog));
        }
      }
    }
  }
  return {files: found.filter((file, index) => found.findIndex(other => other.logicalKey === file.logicalKey) === index)};
}

async function cueReferences(input, file) {
  if (!file || file.sizeBytes > 1024 * 1024) {throw new Error("RUNTIME_CUE_INVALID");}
  const handle = await openContent(requireLocator(input, file));
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    bytes = Buffer.alloc(file.sizeBytes);
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  } finally {await handle.close();}
  if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  return cueContentReferences(bytes, file.logicalKey, input.files.map(item => item.logicalKey));
}

/** Stream an ordinary, deterministic STORE ZIP without retaining the project bytes in memory. */
export async function assembleResource(input, signal) {
  if (!Array.isArray(input.files) || !input.files.length || input.files.length >= 65535 ||
    typeof input.outputPath !== "string" || !input.outputPath.startsWith("/")) {throw new Error("RUNTIME_RESOURCE_INVALID");}
  const rows = input.files.map(file => ({file, name: input.paths?.[file.logicalKey] ?? file.logicalKey}));
  if (rows.some(row => !safePath(row.name)) || new Set(rows.map(row => row.name)).size !== rows.length) {throw new Error("RUNTIME_RESOURCE_INVALID");}
  rows.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
  const output = await open(input.outputPath, "wx", 0o600), resultHash = createHash("sha256"), central = []; let offset = 0;
  const emit = async bytes => {
    signal?.throwIfAborted();
    let at = 0;
    while (at < bytes.length) {const {bytesWritten} = await output.write(bytes, at, bytes.length - at); if (!bytesWritten) {throw new Error("RUNTIME_RESOURCE_WRITE_FAILED");} at += bytesWritten;}
    resultHash.update(bytes); offset += bytes.length; if (offset >= 0xffffffff) {throw new Error("RUNTIME_RESOURCE_TOO_LARGE");}
  };
  try {
    for (const {file, name} of rows) {
      signal?.throwIfAborted();
      const source = await openContent(requireLocator(input, file));
      try {
        const info = await source.stat();
        if (!info.isFile() || info.size !== file.sizeBytes || info.size >= 0xffffffff) {throw new Error("RUNTIME_CONTENT_CHANGED");}
        const encoded = Buffer.from(name), start = offset, header = Buffer.alloc(30);
        if (encoded.length > 65535) {throw new Error("RUNTIME_RESOURCE_INVALID");}
        header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0808, 6);
        header.writeUInt16LE(33, 12); header.writeUInt16LE(encoded.length, 26);
        await emit(header); await emit(encoded);
        const hash = createHash("sha256"), chunk = Buffer.alloc(1024 * 1024); let position = 0, crc = 0;
        while (position < info.size) {
          const {bytesRead} = await source.read(chunk, 0, Math.min(chunk.length, info.size - position), position);
          if (!bytesRead) {throw new Error("RUNTIME_CONTENT_CHANGED");}
          const bytes = chunk.subarray(0, bytesRead); hash.update(bytes); crc = crc32(bytes, crc); await emit(bytes); position += bytesRead;
        }
        if (hash.digest("hex") !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
        const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4);
        descriptor.writeUInt32LE(info.size, 8); descriptor.writeUInt32LE(info.size, 12); await emit(descriptor);
        central.push(zipCentral(encoded, start, info.size, crc));
      } finally {await source.close();}
    }
    const start = offset;
    for (const row of central) {await emit(row);}
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(rows.length, 8); end.writeUInt16LE(rows.length, 10);
    end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16); await emit(end); await output.sync();
    return {path: input.outputPath, sizeBytes: offset, sha256: resultHash.digest("hex")};
  } catch (error) {await output.close(); await rm(input.outputPath, {force: true}); throw error;}
  finally {await output.close();}
}
function zipCentral(name, start, size, crc) {
  const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0808, 8); header.writeUInt16LE(33, 14); header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20); header.writeUInt32LE(size, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(start, 42);
  return Buffer.concat([header, name]);
}

export async function detectScummvm(input, signal) {
  if (typeof input.providerRoot !== "string" || !input.providerRoot.startsWith("/") ||
    typeof input.treeRoot !== "string" || !input.treeRoot.startsWith("/")) {throw new Error("RUNTIME_DETECTION_INPUT_INVALID");}
  const providerRoot = input.providerRoot;
  const integrity = JSON.parse(await readFile(join(providerRoot, "integrity.json"), "utf8"));
  const source = "assets/scummvm/native/linux-x86_64/scummvm-detector";
  const proof = integrity.files.find(file => file.path === source);
  const bytes = await readFile(join(providerRoot, source));
  if (!proof || proof.sizeBytes !== bytes.byteLength || proof.sha256 !== sha256(bytes)) {throw new Error("RUNTIME_DETECTOR_INTEGRITY_FAILED");}
  const manifest = JSON.parse(await readFile(join(providerRoot, "assets/scummvm/manifest.json"), "utf8"));
  const manifestBytes = await readFile(join(providerRoot, "assets/scummvm/manifest.json"));
  const manifestProof = integrity.files.find(file => file.path === "assets/scummvm/manifest.json");
  if (!manifestProof || manifestProof.sizeBytes !== manifestBytes.length || manifestProof.sha256 !== sha256(manifestBytes)) {throw new Error("RUNTIME_DETECTOR_INTEGRITY_FAILED");}
  let count = 0;
  async function checkTree(path) {
    for (const item of await readdir(path, {withFileTypes: true})) {
      if (++count > 100000 || item.isSymbolicLink() || !item.isDirectory() && !item.isFile()) {throw new Error("RUNTIME_DETECTION_INPUT_INVALID");}
      if (item.isDirectory()) {await checkTree(join(path, item.name));}
    }
  }
  await checkTree(input.treeRoot);
  const temporary = await mkdtemp(join(tmpdir(), "retrom-runtime-detect-"));
  try {
    const tool = join(temporary, "scummvm-detector");
    await copyFile(join(providerRoot, source), tool); await chmod(tool, 0o700);
    const {stdout} = await promisify(execFile)(tool, ["--config=/dev/null", "--retrom-detect", "--recursive",
      `--path=${input.treeRoot}`, `--savepath=${temporary}`], {cwd: temporary, timeout: 45000, maxBuffer: 16 * 1024 * 1024,
      signal, env: {LANG: "C.UTF-8", HOME: temporary, XDG_CONFIG_HOME: temporary}});
    const output = JSON.parse(stdout);
    if (output.schemaVersion !== 1 || output.upstreamCommit !== manifest.upstreamCommit || output.error !== null ||
      !Array.isArray(output.candidates) || output.candidates.length > 4096) {throw new Error("RUNTIME_DETECTION_RESULT_INVALID");}
    const candidates = output.candidates.map(candidate => {
      const options = {engineId: candidate.engineId, gameId: candidate.gameId, root: candidate.root,
        language: candidate.language, platform: candidate.platform, extra: candidate.extra,
        guiOptions: candidate.guiOptions, filename: candidate.config?.filename ?? null};
      const blocker = candidate.hasUnknownFiles ? "UNKNOWN_VARIANT" : !candidate.canBeAdded || candidate.isAddOn || candidate.supportLevel === 3
        ? "UNSUPPORTED_GAME" : !Object.hasOwn(manifest.engines, candidate.engineId) ? "ENGINE_UNAVAILABLE" : null;
      return {id: sha256(Buffer.from(JSON.stringify(options))), description: candidate.description, options, blocker};
    });
    return {candidates, automaticSelection: candidates.length === 1 && candidates[0].blocker === null ? candidates[0].id : null};
  } finally {await rm(temporary, {recursive: true, force: true});}
}

let tables;
export async function arcadeTables() {
  return tables ??= readFile(fileURLToPath(new URL("../assets/facts/arcade-catalog.json.gz", import.meta.url)))
    .then(bytes => JSON.parse(gunzipSync(bytes)));
}
export async function identifyHostBIOS(input) {
  const {identifyBIOSFile} = await import("../dist/runtime/index.js");
  const direct = identifyBIOSFile(input.file, input.requirements);
  if (!input.path || !input.file.name?.toLowerCase().endsWith(".zip")) {return direct;}
  const members = await biosMembers(input.path);
  const memberIdentity = sha256(Buffer.from(JSON.stringify(members.map(member => [member.name, member.sizeBytes, member.sha256])
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))));
  const names = members.map(member => member.name);
  return input.requirements.flatMap(requirement => {
    if (requirement.archiveEntries?.length) {
      // Content alone identifies these packages; their names and digests vary by release and language.
      const identified = requirement.archiveEntries.every(entry => hasArchiveEntry(names, entry)) &&
        !requirement.archiveExcludes?.some(entry => hasArchiveEntry(names, entry));
      return identified ? [{...requirement, candidate: {memberIdentity, matchedMembers: requirement.archiveEntries.length, totalMembers: members.length}}] : [];
    }
    if (!requirement.members?.length) {return direct.includes(requirement) ? [requirement] : [];}
    const matched = requirement.members.filter(expected => matchesBIOSMember(members, expected));
    const named = input.file.name.toLowerCase() === requirement.logicalName.toLowerCase();
    if (!named && !requirement.members.every(expected => !expected.required || matched.includes(expected))) {return [];}
    return [{...requirement, candidate: {memberIdentity, matchedMembers: matched.length, totalMembers: members.length}}];
  });
}

function matchesBIOSMember(members, expected) {
  return members.some(member => member.sizeBytes === expected.sizeBytes && (expected.sha1
    ? member.sha1 === expected.sha1.toLowerCase() : member.crc32 === expected.crc32.toLowerCase()));
}

const biosEvidence = new Map();
async function biosMembers(path) {
  const digest = await biosArchiveDigest(path), key = digest.sha256;
  if (!biosEvidence.has(key)) {
    if (biosEvidence.size >= 128) {biosEvidence.delete(biosEvidence.keys().next().value);}
    const pending = zipMembers({path, offset: 0, sizeBytes: digest.sizeBytes}, {digests: true}).catch(error => {biosEvidence.delete(key); throw error;});
    biosEvidence.set(key, pending);
  }
  return biosEvidence.get(key);
}

async function biosArchiveDigest(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 512 * 1024 * 1024) {throw new Error("RUNTIME_CONTENT_UNAVAILABLE");}
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536);
    for (let position = 0; position < info.size;) {
      const {bytesRead} = await handle.read(buffer, 0, Math.min(buffer.length, info.size - position), position);
      if (!bytesRead) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    return {sha256: hash.digest("hex"), sizeBytes: info.size};
  } finally {await handle.close();}
}

export async function verifyHostBIOS(input) {
  const {requirement, path} = input;
  if (requirement.archiveEntries?.length) {return verifyArchiveEntries(requirement.archiveEntries, path);}
  if (!requirement.members?.length) {return null;}
  try {
    const members = await biosMembers(path);
    const matched = requirement.members.filter(expected => matchesBIOSMember(members, expected));
    const missingMembers = requirement.members.filter(expected => expected.required && !matched.includes(expected)).map(expected => expected.name);
    return {status: missingMembers.length ? "incomplete" : "valid", matchedMembers: matched.length,
      expectedMembers: requirement.members.length, missingMembers};
  } catch {
    return {status: "invalid", matchedMembers: 0, expectedMembers: requirement.members.length,
      missingMembers: requirement.members.filter(expected => expected.required).map(expected => expected.name)};
  }
}

/** An archive mounted at a core directory must hold these entries at its root; only the central directory is read. */
async function verifyArchiveEntries(entries, path) {
  let names = [];
  try {
    const info = await stat(path);
    names = (await zipMembers({path, offset: 0, sizeBytes: info.size})).map(member => member.name);
  } catch {names = [];}
  const missingMembers = entries.filter(entry => !hasArchiveEntry(names, entry));
  const matchedMembers = entries.length - missingMembers.length;
  return {status: !missingMembers.length ? "valid" : matchedMembers ? "incomplete" : "invalid",
    matchedMembers, expectedMembers: entries.length, missingMembers};
}

/** A trailing slash names a directory holding any member; otherwise the exact file. Names compare case-insensitively. */
function hasArchiveEntry(names, entry) {
  const wanted = entry.toLowerCase();
  return names.some(name => wanted.endsWith("/") ? name.toLowerCase().startsWith(wanted) : name.toLowerCase() === wanted);
}
