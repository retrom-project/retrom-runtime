import {createHash} from "node:crypto";
import {createReadStream, constants} from "node:fs";
import {open, readFile, writeFile, lstat, mkdtemp, copyFile, chmod, rm, readdir, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {gunzipSync, crc32} from "node:zlib";
import {unzipSync, zipSync} from "fflate";
import {parseRuntimeConfiguration, contentHash, runtimeBindings, identifyPSXRegion, resolveSavedRuntimeRequest,
  contentBIOSRequirements, dosEntryCandidates, arcadeParentOptions} from "../dist/runtime/index.js";

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
  return {...input, evidence, archiveMembers, selection, ...(input.platformId === "arcade" ? {arcadeCatalogs: await arcadeTables()} : {})};
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
    prepared = {...prepared, arcadeCatalog: tables[coreId],
      archives: {[file.logicalKey]: await zipMembers(requireLocator(input, file))}};
  }
  return contentBIOSRequirements(prepared);
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
export async function assembleResource(input) {
  if (!Array.isArray(input.files) || !input.files.length || input.files.length >= 65535 ||
    typeof input.outputPath !== "string" || !input.outputPath.startsWith("/")) {throw new Error("RUNTIME_RESOURCE_INVALID");}
  const rows = input.files.map(file => ({file, name: input.paths?.[file.logicalKey] ?? file.logicalKey}));
  if (rows.some(row => !safePath(row.name)) || new Set(rows.map(row => row.name)).size !== rows.length) {throw new Error("RUNTIME_RESOURCE_INVALID");}
  rows.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
  const output = await open(input.outputPath, "wx", 0o600), resultHash = createHash("sha256"), central = []; let offset = 0;
  const emit = async bytes => {
    let at = 0;
    while (at < bytes.length) {const {bytesWritten} = await output.write(bytes, at, bytes.length - at); if (!bytesWritten) {throw new Error("RUNTIME_RESOURCE_WRITE_FAILED");} at += bytesWritten;}
    resultHash.update(bytes); offset += bytes.length; if (offset >= 0xffffffff) {throw new Error("RUNTIME_RESOURCE_TOO_LARGE");}
  };
  try {
    for (const {file, name} of rows) {
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

export async function parentArchive(input) {
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 32 ||
    typeof input.outputPath !== "string" || !input.outputPath.startsWith("/")) {throw new Error("RUNTIME_PARENT_INVALID");}
  const members = Object.create(null), hashes = new Map(); let expanded = 0;
  for (const file of input.files) {
    const path = requireLocator(input, file), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes || info.size > 512 * 1024 * 1024) {throw new Error("RUNTIME_PARENT_INVALID");}
    const index = await zipMembers(path);
    expanded += index.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (expanded > 512 * 1024 * 1024) {throw new Error("RUNTIME_PARENT_TOO_LARGE");}
    const bytes = await readFile(path);
    if (sha256(bytes) !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    const files = unzipSync(bytes);
    for (const [name, content] of Object.entries(files)) {
      if (!safePath(name) || name.endsWith("/")) {throw new Error("RUNTIME_PARENT_INVALID");}
      const hash = sha256(content), existing = hashes.get(name);
      if (existing && existing !== hash) {throw new Error("RUNTIME_PARENT_MEMBER_CONFLICT");}
      hashes.set(name, hash); members[name] = [content, {level: 0, mtime: new Date("1980-01-01T00:00:00Z")}];
    }
  }
  const bytes = zipSync(Object.fromEntries(Object.keys(members).sort().map(key => [key, members[key]])));
  await writeFile(input.outputPath, bytes, {flag: "wx", mode: 0o600});
  return {path: input.outputPath, sizeBytes: bytes.byteLength, sha256: sha256(bytes)};
}

async function zipMembers(path) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, 65557), tail = Buffer.alloc(length);
    await handle.read(tail, 0, length, info.size - length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {if (tail.readUInt32LE(i) === 0x06054b50) {end = i; break;}}
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
    const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || size > 64 * 1024 * 1024 || offset + size > info.size) {throw new Error("RUNTIME_ARCHIVE_LIMIT");}
    const directory = Buffer.alloc(size); await handle.read(directory, 0, size, offset);
    const result = [], names = new Set(); let at = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > size || directory.readUInt32LE(at) !== 0x02014b50 || directory.readUInt16LE(at + 8) & 1) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
      const length = directory.readUInt16LE(at + 28), extra = directory.readUInt16LE(at + 30), comment = directory.readUInt16LE(at + 32);
      const name = directory.subarray(at + 46, at + 46 + length).toString("utf8");
      if (!safePath(name.replace(/\/$/u, "")) || names.has(name)) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
      names.add(name);
      if (!name.endsWith("/")) {result.push({name, sizeBytes: directory.readUInt32LE(at + 24), crc32: directory.readUInt32LE(at + 16).toString(16).padStart(8, "0")});}
      at += 46 + length + extra + comment;
    }
    if (at !== size) {throw new Error("RUNTIME_ARCHIVE_INVALID");}
    return result;
  } finally {await handle.close();}
}
function requireLocator(input, file) {
  const path = input.locators?.[file.logicalKey];
  if (typeof path !== "string" || !path.startsWith("/")) {throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");}
  return path;
}
function safePath(path) {return typeof path === "string" && path.length > 0 && path.length <= 4096 && !path.startsWith("/") &&
  !path.includes("\\") && [...path].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
  path.split("/").every(part => part && part !== "." && part !== "..");}
function sha256(bytes) {return createHash("sha256").update(bytes).digest("hex");}

export async function detectScummvm(input) {
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
      env: {LANG: "C.UTF-8", HOME: temporary, XDG_CONFIG_HOME: temporary}});
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
  return tables ??= JSON.parse(gunzipSync(await readFile(fileURLToPath(new URL("../assets/facts/arcade-catalog.json.gz", import.meta.url)))));
}
export async function identifyHostBIOS(input) {
  const {identifyBIOSFile} = await import("../dist/runtime/index.js");
  const direct = identifyBIOSFile(input.file, input.requirements);
  if (!input.path || !input.file.name?.toLowerCase().endsWith(".zip")) {return direct;}
  const members = await zipMembers(input.path);
  return input.requirements.filter(requirement => requirement.members?.length && requirement.members.every(expected =>
    !expected.required || members.some(member => member.sizeBytes === expected.sizeBytes && member.crc32 === expected.crc32)));
}
