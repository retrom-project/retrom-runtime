import type {FlycastMachine} from "./flycast-arcade.js";
import {arcadeAncestry} from "./arcade-ancestry.js";
import {configuredMachine, playableArcadeMachine, type ArcadeCatalog, type ArcadeMachine} from "./arcade.js";
import {resolveRuntimeTarget} from "./catalog.js";
import {parseRuntimeConfiguration, validateConfigurationFiles} from "./configuration.js";
import {contentHash} from "./identity.js";
import {selectedRuntimeCore} from "./prepare.js";
import {configurationFailure, utf8Compare} from "./validation.js";
import type {RuntimeContentFile, RuntimeDirectory} from "./types.js";

type Request = {directory: RuntimeDirectory; config: unknown; files: RuntimeContentFile[]};
export type ROMSetRequest = Request & {coreId: string; arcadeCatalog: ArcadeCatalog;
  query?: string; offset?: number; limit?: number; entryFile?: string; romSet?: string};
const entry = (name: string, machine: ArcadeMachine) => ({name, description: machine.description ?? name,
  year: machine.year ?? "", manufacturer: machine.manufacturer ?? ""});
function draftConfiguration(request: ROMSetRequest, coreId: string) {
  let config = parseRuntimeConfiguration(request.config);
  if (request.entryFile !== undefined) {config = parseRuntimeConfiguration({...config, content: {...config.content, entryFile: request.entryFile}});}
  if (request.romSet !== undefined) {
    const core = {...config.cores?.[coreId]};
    if (request.romSet) {core.romSet = request.romSet;} else {delete core.romSet;}
    config = parseRuntimeConfiguration({...config, cores: {...config.cores, [coreId]: core}});
  }
  return config;
}
function searchEntries(catalog: ArcadeCatalog, query: string) {
  return Object.entries(catalog).filter(([name, machine]) => playableArcadeMachine(machine) &&
    [name, machine.description, machine.year, machine.manufacturer].some(text => text?.toLowerCase().includes(query)))
    .sort(([left], [right]) => utf8Compare(left, right));
}
function searchPage(request: ROMSetRequest) {
  const query = (request.query ?? "").trim().toLowerCase(), offset = request.offset ?? 0, limit = request.limit ?? 50;
  if (query.length > 128 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {configurationFailure();}
  return {query, offset, limit};
}

/** One bounded search projection for every Target declaring a paired DAT. */
export function arcadeROMSetOptions(request: ROMSetRequest) {
  const coreId = selectedRuntimeCore(request);
  const config = draftConfiguration(request, coreId);
  contentHash(request.files, "TREE");
  const {target} = resolveRuntimeTarget(request.directory.platformId, coreId, config.content);
  if (config.content.kind !== "ARCADE" || !target.romSetSelection) {configurationFailure("RUNTIME_ROM_SET_UNAVAILABLE");}
  const entryFile = config.content.entryFile;
  const file = request.files.find(file => file.logicalKey === entryFile);
  if (!file) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  const {query, offset, limit} = searchPage(request);
  const entries = searchEntries(request.arcadeCatalog, query);
  const automatic = configuredMachine(coreId, {...config, cores: {}}, file.name);
  const automaticSelection = playableArcadeMachine(request.arcadeCatalog[automatic]) ? automatic : null;
  const name = config.cores?.[coreId]?.romSet ?? automaticSelection;
  const machine = name ? request.arcadeCatalog[name] : undefined;
  return {coreId, datSHA256: target.romSetSelection.datSHA256, automaticSelection,
    selected: name && playableArcadeMachine(machine) ? entry(name, machine) : null,
    entries: entries.slice(offset, offset + limit).map(([name, machine]) => entry(name, machine)), total: entries.length, offset, limit};
}

/** Prune obsolete Parent references, while preserving selections and shared files belonging to other cores. */
export function reconcileArcadeConfiguration(request: Request & {previousConfig?: unknown; arcadeCatalogs: Readonly<Record<string, ArcadeCatalog>>; flycastCatalogs?: Readonly<Record<string, readonly FlycastMachine[]>>}) {
  const config = parseRuntimeConfiguration(request.config);
  validateConfigurationFiles(config, request.files);
  if (!("entryFile" in config.content)) {return {config, removedParentFiles: []};}
  const entryFile = config.content.entryFile;
  const file = request.files.find(file => file.logicalKey === entryFile)!;
  for (const [coreId, core] of Object.entries(config.cores ?? {})) {
    const {target} = resolveRuntimeTarget(request.directory.platformId, coreId, config.content);
    if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
      pruneFlycastParents(core, file, request.files, request.flycastCatalogs?.[coreId]);
      continue;
    }
    const catalog = request.arcadeCatalogs[coreId];
    if (core.romSet !== undefined && (!target.romSetSelection ||
      !playableArcadeMachine(catalog?.[core.romSet]))) {configurationFailure("RUNTIME_ROM_SET_INVALID", {coreId});}
    if (!catalog) {continue;}
    const name = configuredMachine(coreId, config, file.name);
    const ancestors = playableArcadeMachine(catalog[name]) ? new Set(arcadeAncestry(name, catalog).parents
      .slice(1).filter(({machine}) => !machine.bios).map(({id}) => id)) : new Set<string>();
    if (core.parentFiles) {core.parentFiles = core.parentFiles.filter(key => {
      const parent = request.files.find(item => item.logicalKey === key);
      return parent && ancestors.has(parent.name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase());
    });}
  }
  const retained = new Set(Object.values(config.cores ?? {}).flatMap(core => core.parentFiles ?? []));
  retained.add(config.content.entryFile);
  const previous = request.previousConfig === undefined ? config : parseRuntimeConfiguration(request.previousConfig);
  const previousParents = new Set(Object.values(previous.cores ?? {}).flatMap(core => core.parentFiles ?? []));
  return {config, removedParentFiles: [...previousParents].filter(key => !retained.has(key))};
}

function pruneFlycastParents(core: {parentFiles?: string[]}, file: RuntimeContentFile,
  files: readonly RuntimeContentFile[], catalog: readonly FlycastMachine[] | undefined) {
  const name = file.name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase();
  const parent = catalog?.find(machine => machine.name === name)?.parent;
  if (core.parentFiles) {core.parentFiles = core.parentFiles.filter(key => {
    const candidate = files.find(file => file.logicalKey === key);
    return candidate && /\.zip$/iu.test(candidate.name) && candidate.name.split("/").at(-1)!.slice(0, -4).toLowerCase() === parent;
  });}
}
