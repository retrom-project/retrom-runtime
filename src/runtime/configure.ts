import {parseRuntimeConfiguration} from "./configuration.js";
import {runtimeBindings} from "./catalog.js";
import {contentHash} from "./identity.js";
import type {RPGEngine, RuntimeConfiguration, RuntimeContent, RuntimeContentFile} from "./types.js";
import {configurationFailure, logicalPath, object, utf8Compare} from "./validation.js";
import {validateConfiguredOptions} from "./prepare.js";
import {detectLcfEngine} from "./lcf.js";
import formats from "./content-formats.json" with {type: "json"};
import type {ArcadeCatalog} from "./arcade.js";

export type ConfigureRequest = {
  platformId: string;
  coreIds: string[];
  files: RuntimeContentFile[];
  /** Bounded evidence is read by the host from these exact immutable files. */
  evidence?: Record<string, {text?: string; bytesBase64?: string}>;
  /** Archive members are inspected by the runtime; the outer archive remains the Game file. */
  archiveMembers?: Record<string, string[]>;
  arcadeCatalogs?: Readonly<Record<string, ArcadeCatalog>>;
  selection?: {entryFile?: string; entryPath?: string; scummvm?: Record<string, string | null>};
};

/** Construct game-specific rules from immutable file facts, with no host storage IDs or installation state. */
export function configureRuntime(input: ConfigureRequest): RuntimeConfiguration {
  contentHash(input.files, "TREE");
  if (!Array.isArray(input.coreIds) || input.coreIds.length === 0 || !input.coreIds.every(core =>
    runtimeBindings.some(binding => binding.coreId === core && binding.platformIds.includes(input.platformId)))) {
    configurationFailure("RUNTIME_CORE_UNAVAILABLE");
  }
  validateEvidence(input);
  const content = constructContent(input);
  const cores = input.platformId === "arcade" && content.kind === "ARCADE" ? arcadeParents(input, content.entryFile)
    : input.platformId === "scummvm" ? {scummvm: {options: scummvmOptions(input)}}
    : input.platformId === "ons" ? {onscripter_yuri: {options: {scriptEncoding: "utf8"}}} : undefined;
  const config = parseRuntimeConfiguration({content, ...(cores ? {cores} : {})});
  validateConfiguredOptions(input.platformId, config, input.files);
  return config;
}

function constructContent(input: ConfigureRequest): RuntimeContent {
  const choose = (test: (name: string) => boolean) => chooseFile(input, test);
  switch (input.platformId) {
  case "rpgmaker": return rpgContent(input);
  case "scummvm": return {kind: "SCUMMVM_PROJECT"};
  case "dos": return dosContent(input);
  case "arcade": return {kind: "ARCADE", entryFile: arcadeEntry(input).logicalKey};
  case "ons": return {kind: "ONS_PROJECT", entryFile: choosePreferred(input, [/(?:^|\/)nscript\.dat$/u, /(?:^|\/)nscr_sec\.dat$/u, /(?:^|\/)0\.txt$/u, /(?:^|\/)00\.txt$/u]).logicalKey};
  case "kirikiri": return {kind: "KIRIKIRI_PROJECT", entryFile: choosePreferred(input, [/(?:^|\/)startup\.tjs$/u, /(?:^|\/)data\.xp3$/u, /\.xp3$/u]).logicalKey};
  case "butterscotch": return {kind: "BUTTERSCOTCH_PROJECT", entryFile: choosePreferred(input, [/(?:^|\/)data\.win$/u, /(?:^|\/)runner\.js$/u, /(?:^|\/)game\.js$/u, /(?:^|\/)data\.js$/u, /(?:^|\/)index\.html$/u]).logicalKey};
  case "tyranoscript": return {kind: "TYRANOSCRIPT_PROJECT", entryFile: choose(name => /(?:^|\/)index\.html$/u.test(name)).logicalKey};
  case "cavestory": return {kind: "NXENGINE_PROJECT", entryFile: choose(name => /(?:^|\/)doukutsu\.exe$/u.test(name)).logicalKey};
  case "daphne": return {kind: "DAPHNE_PROJECT", entryFile: choose(name => /\.(?:txt|framefile)$/u.test(name)).logicalKey};
  default: return singleFileContent(input);
  }
}
function dosContent(input: ConfigureRequest): RuntimeContent {
  const file = chooseFile(input, name => /\.(?:zip|dosz)$/u.test(name));
  const entries = input.archiveMembers?.[file.logicalKey] ?? [];
  if (input.selection?.entryPath !== undefined && !logicalPath(input.selection.entryPath)) {configurationFailure("RUNTIME_DOS_ENTRY_INVALID");}
  const possible = dosEntryCandidates(entries);
  const entryPath = input.selection?.entryPath ?? (possible.length === 1 ? possible[0] : null);
  if (entryPath !== null && !possible.includes(entryPath)) {configurationFailure("RUNTIME_DOS_ENTRY_INVALID");}
  return {kind: "DOS_BUNDLE", entryFile: file.logicalKey, ...(entryPath === null ? {} : {entryPath})};
}
/** Preserve complete safe paths; both configuration and the offline projection use these candidates. */
export function dosEntryCandidates(entries: readonly string[]) {
  return [...new Set(entries.filter(name => /\.(?:exe|com|bat)$/iu.test(name) && logicalPath(name)))].sort(utf8Compare);
}
function singleFileContent(input: ConfigureRequest): RuntimeContent {
  const declarations = formats.cores as Readonly<Record<string, {extensions: readonly string[]}>>;
  const extensions = new Set(input.coreIds.flatMap(coreId => {
    const declaration = declarations[coreId];
    if (!declaration) {configurationFailure("RUNTIME_DECLARATION_INVALID");}
    return declaration.extensions;
  }));
  const cue = extensions.has("cue") && input.files.some(file => /\.cue$/iu.test(file.name));
  return {kind: "SINGLE_FILE", entryFile: chooseFile(input, name => cue ? name.endsWith(".cue")
    : extensions.has(name.slice(name.lastIndexOf(".") + 1))).logicalKey};
}
function archiveName(file: RuntimeContentFile) {return file.name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase();}
function arcadeAncestors(catalog: ArcadeCatalog | undefined, id: string): string[] {
  const parents: string[] = [], seen = new Set([id]);
  let machine = catalog?.[id];
  while (machine?.parent) {
    const parent = machine.parent;
    if (seen.has(parent) || seen.size > 32) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    seen.add(parent); parents.push(parent); machine = catalog?.[parent];
  }
  return parents;
}
function arcadeEntry(input: ConfigureRequest): RuntimeContentFile {
  if (input.selection?.entryFile) {return chooseFile(input, name => name.endsWith(".zip"));}
  const candidates = input.files.filter(file => /\.zip$/iu.test(file.name));
  const parents = new Set(input.coreIds.flatMap(core => candidates.flatMap(file =>
    arcadeAncestors(input.arcadeCatalogs?.[core], archiveName(file)))));
  const leaves = candidates.filter(file => !parents.has(archiveName(file)));
  if (leaves.length !== 1) {configurationFailure("RUNTIME_ENTRY_REQUIRED");}
  return leaves[0];
}
function arcadeParents(input: ConfigureRequest, entry: string): RuntimeConfiguration["cores"] {
  const file = input.files.find(file => file.logicalKey === entry)!;
  const cores: NonNullable<RuntimeConfiguration["cores"]> = {};
  for (const core of input.coreIds) {
    const catalog = input.arcadeCatalogs?.[core], parentFiles: string[] = [];
    for (const parent of arcadeAncestors(catalog, archiveName(file))) {
      if (catalog?.[parent]?.bios) {continue;}
      const matches = input.files.filter(item => /\.zip$/iu.test(item.name) && archiveName(item) === parent);
      if (matches.length > 1) {configurationFailure("RUNTIME_ENTRY_REQUIRED");}
      if (matches.length) {parentFiles.push(matches[0].logicalKey);}
    }
    if (parentFiles.length) {cores[core] = {parentFiles};}
  }
  return Object.keys(cores).length ? cores : undefined;
}
function chooseFile(input: ConfigureRequest, test: (name: string) => boolean): RuntimeContentFile {
  const candidates = input.files.filter(file => test(file.name.toLowerCase()));
  if (input.selection?.entryFile) {
    const selected = candidates.find(file => file.logicalKey === input.selection!.entryFile);
    if (selected) {return selected;}
    configurationFailure("RUNTIME_ENTRY_MISSING");
  }
  if (candidates.length !== 1) {configurationFailure("RUNTIME_ENTRY_REQUIRED");}
  return candidates[0];
}
function rpgContent(input: ConfigureRequest): RuntimeContent {
  const engines = new Map<RuntimeContentFile, RPGEngine>();
  for (const file of input.files) {
    const name = file.logicalKey.toLowerCase();
    if (/(?:^|\/)js\/rmmz_core\.js$/u.test(name)) {engines.set(file, "RPGMZ");}
    if (/(?:^|\/)js\/rpg_core\.js$/u.test(name)) {engines.set(file, "RPGMV");}
    if (/(?:^|\/)game\.ini$/u.test(name)) {engines.set(file, rgssEngine(input.evidence?.[file.logicalKey]?.text ?? ""));}
    if (/(?:^|\/)rpg_rt\.ldb$/u.test(name)) {
      const bytes = input.evidence?.[file.logicalKey]?.bytesBase64;
      if (!bytes) {configurationFailure("RUNTIME_RPG_EVIDENCE_REQUIRED");}
      engines.set(file, detectLcfEngine(Uint8Array.from(atob(bytes), character => character.charCodeAt(0))));
    }
  }
  if (engines.size !== 1) {configurationFailure("RUNTIME_RPG_ENGINE_AMBIGUOUS");}
  const [file, engine] = [...engines][0];
  const entry = engine === "RPGMV" || engine === "RPGMZ"
    ? chooseFile(input, name => /(?:^|\/)index\.html$/u.test(name)) : file;
  return {kind: "RPG_MAKER_PROJECT", entryFile: entry.logicalKey, engine};
}
function scummvmOptions(input: ConfigureRequest) {
  const options = input.selection?.scummvm;
  if (!options || !object(options)) {configurationFailure("RUNTIME_SCUMMVM_SELECTION_REQUIRED");}
  return {...options};
}
function validateEvidence(input: ConfigureRequest) {
  for (const [path, evidence] of Object.entries(input.evidence ?? {})) {
    if (!input.files.some(file => file.logicalKey === path) || !object(evidence) ||
      evidence.text !== undefined && (typeof evidence.text !== "string" || evidence.text.length > 262144) ||
      evidence.bytesBase64 !== undefined && (typeof evidence.bytesBase64 !== "string" || evidence.bytesBase64.length > 32 * 1024 * 1024)) {
      configurationFailure("RUNTIME_EVIDENCE_INVALID");
    }
  }
}

function rgssEngine(text: string): RPGEngine {
  const scripts = /^scripts\s*=\s*[^\r\n]*\.(rxdata|rvdata2?)$/imu.exec(text)?.[1]?.toLowerCase();
  const engine = scripts === "rxdata" ? "RPGXP" : scripts === "rvdata" ? "RPGVX" : scripts === "rvdata2" ? "RPGVXACE" : null;
  if (!engine) {configurationFailure("RUNTIME_RPG_EVIDENCE_REQUIRED");}
  return engine;
}

function choosePreferred(input: ConfigureRequest, patterns: readonly RegExp[]): RuntimeContentFile {
  if (input.selection?.entryFile) {return chooseFile(input, () => true);}
  for (const pattern of patterns) {
    const matching = input.files.filter(file => pattern.test(file.name.toLowerCase()));
    if (matching.length === 1) {return matching[0];}
    if (matching.length > 1) {configurationFailure("RUNTIME_ENTRY_REQUIRED");}
  }
  configurationFailure("RUNTIME_ENTRY_MISSING");
}
