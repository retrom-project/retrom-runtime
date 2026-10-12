import {createHash} from "node:crypto";
import {createReadStream, constants} from "node:fs";
import {open, readFile, lstat, mkdtemp, copyFile, chmod, rm, readdir, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {gunzipSync, crc32} from "node:zlib";
import {parseRuntimeConfiguration, contentHash, runtimeBindings, identifyPSXRegion, resolveSavedRuntimeRequest,
  contentBIOSRequirements, missingROMMember, dosEntryCandidates, arcadeParentOptions, resolveRuntimeTarget, flycastMachine, flycastContentReferences, flycastMedia} from "../dist/runtime/index.js";
import {zipMembers, requireLocator, safePath, sha256} from "./runtime-archive-input.mjs";
export {parentArchive} from "./runtime-archive-input.mjs";

export async function configureHostInput(input) {
  contentHash(input.files, "TREE");
  const evidence = {...input.evidence}, archiveMembers = {...input.archiveMembers};
  for (const file of input.files) {
    const name = file.logicalKey.split("/").at(-1).toLowerCase();
    const needsEvidence = input.platformId === "rpgmaker" && ["game.ini", "rpg_rt.ldb"].includes(name);
    if (needsEvidence && !evidence[file.logicalKey] && input.locators?.[file.logicalKey]) {
      const maximum = name === "game.ini" ? 262144 : 24 * 1024 * 1024;
      if (file.sizeBytes > maximum) {throw new Error("RUNTIME_EVIDENCE_TOO_LARGE");}
      const bytes = await readFile(requireLocator(input, file));
      if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      evidence[file.logicalKey] = name === "game.ini" ? {text: new TextDecoder().decode(bytes)} : {bytesBase64: bytes.toString("base64")};
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
      const source = requireLocator(input, file), info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      const destination = join(treeRoot, file.logicalKey); await mkdir(dirname(destination), {recursive: true});
      await copyFile(source, destination);
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
  return {...input, arcadeCatalog: tables[coreId], archives};
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
  const handle = await open(requireLocator(input, file), constants.O_RDONLY | constants.O_NOFOLLOW);
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
    prepared = {...prepared, arcadeCatalog: tables[coreId], archives};
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
    const members = await zipMembers(file.path);
    for (const expected of requirement.members) {
      const missing = expected.required && missingROMMember(requirement.coreId, requirement.logicalName.replace(/\.zip$/iu, ""),
        "BIOS", {name: expected.name, size: String(expected.sizeBytes), crc: expected.crc32}, members);
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
    ...(input.attachFile === undefined ? [] : [input.attachFile])]);
  for (const key of keys) {
    const file = input.files.find(item => item.logicalKey === key);
    if (file) {archives[key] = await zipMembers(requireLocator(input, file));}
  }
  return arcadeParentOptions({...input, archives, arcadeCatalog: tables[coreId]});
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
  const handle = await open(requireLocator(input, file), constants.O_RDONLY | constants.O_NOFOLLOW);
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
  for (const file of input.files.filter(file => file.logicalKey.toLowerCase().endsWith(".cue"))) {
    found.push(...await cueReferences(input, file));
  }
  const directory = input.directory;
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
  const handle = await open(requireLocator(input, file), "r");
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    bytes = Buffer.alloc(file.sizeBytes);
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  } finally {await handle.close();}
  if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  const entry = file.logicalKey, root = entry.slice(0, entry.lastIndexOf("/") + 1), references = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!/^\s*FILE\s/iu.test(line)) {continue;}
    const match = /^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+\s*$/iu.exec(line), name = match?.[1] ?? match?.[2];
    if (!name || !safePath(name)) {throw new Error("RUNTIME_CUE_INVALID");}
    references.push({logicalKey: root + name, relativeTo: entry, relativePath: name});
  }
  if (!references.length) {throw new Error("RUNTIME_CUE_INVALID");}
  return references;
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
      const path = requireLocator(input, file), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      const source = await open(path, "r");
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
  const members = await zipMembers(input.path);
  return input.requirements.filter(requirement => requirement.members?.length && requirement.members.every(expected =>
    !expected.required || members.some(member => member.sizeBytes === expected.sizeBytes && (member.crc32 === expected.crc32 ||
      input.file.name.toLowerCase() === requirement.logicalName.toLowerCase() && member.name === expected.name))));
}
