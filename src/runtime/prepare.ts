import {projectProviderManifest} from "../provider/manifest.js";
import {validateTargetOptionsAgainstSchema} from "../provider/module-api.js";
import type {TargetOptionsV1} from "../provider/module-api.js";
import type {ResourceKind, TargetDeclaration} from "../provider/declarations.js";
import {resolveRuntimeTarget} from "./catalog.js";
import {thomsonModelOptions} from "./thomson.js";
import {parseRuntimeConfiguration, validateConfigurationFiles} from "./configuration.js";
import {arcadeDependencies, type ArcadeCatalog, type ArchiveMember} from "./arcade.js";
import {arcadeBIOSRequirements, resolveBIOSRequirements} from "./bios.js";
import {contentHash, restorability} from "./identity.js";
import {canonicalJsonBytes} from "../provider/contract.js";
import type {RuntimeContentFile, RuntimeDirectory, RuntimeIdentity, ResourcePlan, RuntimeConfiguration, SaveContext} from "./types.js";
import {configurationFailure, digest, identifier, exact, object} from "./validation.js";

export type PrepareRuntimeRequest = {
  directory: RuntimeDirectory;
  config: unknown;
  files: RuntimeContentFile[];
  coreId?: string;
  /** Frozen Save extinfo; resource locators and authorization remain host-owned. */
  savedContext?: unknown;
  /** Indexed at Provider build/startup, never recomputed by a Range or list request. */
  fingerprints: Readonly<Record<string, string>>;
  archives?: Readonly<Record<string, readonly ArchiveMember[]>>;
  arcadeCatalog?: ArcadeCatalog;
  cueFiles?: string[];
  dosEntries?: readonly string[];
  firmwareEvidence?: {psxRegion?: import("./psx.js").PSXRegion | null};
};

/** Resolve frozen save facts before any content-specific host reads or resource assembly. */
export function resolveSavedRuntimeRequest<T extends PrepareRuntimeRequest>(request: T): T {
  if (request.savedContext === undefined) {return request;}
  const saved = savedContext(request.savedContext);
  if (request.coreId !== undefined && request.coreId !== saved.coreId) {configurationFailure("CORE_UNAVAILABLE");}
  try {selectedRuntimeCore({...request, coreId: saved.coreId});}
  catch {configurationFailure("CORE_UNAVAILABLE");}
  const current = parseRuntimeConfiguration(request.config);
  let content: RuntimeConfiguration["content"];
  try {content = parseRuntimeConfiguration({content: saved.content}).content;}
  catch {configurationFailure("RUNTIME_SAVED_CONTEXT_INVALID");}
  const {provider, target} = resolveRuntimeTarget(request.directory.platformId, saved.coreId, content);
  const project = !["SINGLE_FILE", "DOS_BUNDLE", "ARCADE"].includes(content.kind);
  const romHash = contentHash(request.files, project || request.files.length !== 1 ? "TREE" : "FILE");
  const declaration = projectProviderManifest({...provider, targets: [target]}).targets[0];
  const result = restorability({gameAvailable: true, saveAvailable: true, context: saved as SaveContext,
    current: {coreId: saved.coreId, providerId: provider.providerId, targetId: target.id,
      coreFingerprint: request.fingerprints[`${provider.providerId}/${target.id}`], romHash},
    readFormats: declaration.checkpoint?.readFormats ?? []});
  if (!result.restorable) {configurationFailure(result.reason);}
  let options: TargetOptionsV1;
  try {options = validateTargetOptionsAgainstSchema(saved.runtimeOptions, target.targetOptionsSchema);}
  catch {configurationFailure("RUNTIME_SAVED_CONTEXT_INVALID");}
  // A raw single-file identity permits a rename; a tree identity remains path-sensitive.
  if (!project && request.files.length === 1 && "entryFile" in content) {
    content = {...content, entryFile: request.files[0].logicalKey};
  }
  const config: RuntimeConfiguration = {content, cores: {[saved.coreId]: {
    ...current.cores?.[saved.coreId], options,
  }}};
  const normalized = {...request, config, coreId: saved.coreId, savedContext: undefined};
  const actualOptions = prepareTargetOptions(config, target, saved.coreId, request.files);
  if (String(canonicalJsonBytes(actualOptions)) !== String(canonicalJsonBytes(options))) {
    configurationFailure("RUNTIME_SAVED_CONTEXT_INVALID");
  }
  return normalized;
}

function savedContext(value: unknown): SaveContext {
  const saved = value;
  if (!object(saved) || !exact(saved, ["coreId", "providerId", "targetId", "coreFingerprint", "romHash",
    "checkpointFormat", "content", "runtimeOptions"]) || !identifier(saved.coreId) || !identifier(saved.providerId) ||
    !identifier(saved.targetId) || !digest(saved.coreFingerprint) || !digest(saved.romHash) ||
    typeof saved.checkpointFormat !== "string" || !object(saved.runtimeOptions)) {configurationFailure("RUNTIME_SAVED_CONTEXT_INVALID");}
  return saved as SaveContext;
}

function prepareIdentity(request: PrepareRuntimeRequest) {
  request = resolveSavedRuntimeRequest(request);
  const config = parseRuntimeConfiguration(request.config);
  const directory = request.directory, selectedCore = selectedRuntimeCore(request);
  validateConfigurationFiles(config, request.files);
  validateConfiguredOptions(directory.platformId, config, request.files);
  const {binding, provider, target} = resolveRuntimeTarget(directory.platformId, selectedCore, config.content);
  const fingerprint = request.fingerprints[`${provider.providerId}/${target.id}`];
  if (!digest(fingerprint)) {configurationFailure("RUNTIME_IMPLEMENTATION_UNAVAILABLE");}
  const targetOptions = prepareTargetOptions(config, target, selectedCore, request.files);
  const project = !["SINGLE_FILE", "DOS_BUNDLE", "ARCADE"].includes(config.content.kind);
  const romHash = contentHash(request.files, project || request.files.length !== 1 ? "TREE" : "FILE");
  const declaration = projectProviderManifest({...provider, targets: [target]}).targets[0];
  const identity: RuntimeIdentity = {coreId: binding.coreId, providerId: binding.providerId, targetId: binding.targetId,
    coreFingerprint: fingerprint, romHash};
  return {config, selectedCore, binding, target, targetOptions, declaration, identity};
}

export function prepareRuntime(request: PrepareRuntimeRequest) {
  request = resolveSavedRuntimeRequest(request);
  const {config, selectedCore, binding, target, targetOptions, declaration, identity} = prepareIdentity(request);
  if (config.content.kind === "DOS_BUNDLE" && config.content.entryPath !== undefined &&
    !request.dosEntries?.includes(config.content.entryPath)) {configurationFailure("RUNTIME_DOS_ENTRY_INVALID");}
  let dependencies = {parentFiles: [] as string[], missingParents: [] as string[], biosSets: [] as string[]};
  if (config.content.kind === "ARCADE") {
    if (!request.arcadeCatalog || !request.archives) {configurationFailure("RUNTIME_ARCADE_CATALOG_UNAVAILABLE");}
    dependencies = arcadeDependencies(selectedCore, config, request.files, request.archives, request.arcadeCatalog);
    if (dependencies.missingParents.length) {configurationFailure("RUNTIME_PARENT_MISSING", {parents: dependencies.missingParents.join(",")});}
  }
  return {...identity, config, targetOptions, dependencies,
    biosRequirements: [...resolveBIOSRequirements({providerId: binding.providerId, targetId: binding.targetId, config,
      files: request.files, firmwareEvidence: request.firmwareEvidence}),
      ...(request.arcadeCatalog ? arcadeBIOSRequirements(selectedCore, request.arcadeCatalog, dependencies.biosSets) : [])], checkpoint: declaration.checkpoint, capabilities: declaration.capabilities,
    resources: contentResources(config, target, selectedCore, request.files, request.cueFiles)};
}

function prepareTargetOptions(config: RuntimeConfiguration, target: TargetDeclaration, coreId: string,
  files: readonly RuntimeContentFile[]): TargetOptionsV1 {
  let options = {...config.cores?.[coreId]?.options};
  if (target.id === "theodore" && "entryFile" in config.content) {
    options = thomsonModelOptions(options, config.content.entryFile, files);
  }
  if (target.id === "dosbox-pure") {
    if (config.content.kind !== "DOS_BUNDLE") {configurationFailure();}
    options.dosEntryPath = config.content.entryPath ?? null;
  } else if (target.adapterId.startsWith("emulatorjs")) {options.dosEntryPath = null;}
  if (target.id === "kirikiri2-kag") {
    options.startupXp3Path = config.content.kind === "KIRIKIRI_PROJECT" && config.content.entryFile.toLowerCase().endsWith(".xp3")
      ? projectPaths([config.content.entryFile], config.content.entryFile)[config.content.entryFile] : null;
  }
  if (target.id === "mame-arcade" && options.machine === undefined) {
    const key = "entryFile" in config.content ? config.content.entryFile : "";
    const name = files.find(file => file.logicalKey === key)?.name;
    if (!name) {configurationFailure("RUNTIME_ENTRY_MISSING");}
    options.machine = name.split("/").at(-1)!.replace(/\.[^.]+$/u, "");
  }
  try {return validateTargetOptionsAgainstSchema(options, target.targetOptionsSchema);}
  catch {configurationFailure("RUNTIME_OPTIONS_INVALID", {coreId});}
}

function contentResources(config: RuntimeConfiguration, target: TargetDeclaration, coreId: string,
  files: readonly RuntimeContentFile[], cueFiles?: readonly string[]): ResourcePlan[] {
  const game = target.inputs.find(input => input.role === "game");
  if (!game) {configurationFailure("RUNTIME_DECLARATION_INVALID");}
  const parent = config.cores?.[coreId]?.parentFiles ?? [];
  const resources: ResourcePlan[] = [gameResource(game.kind, config, files)];
  if (game.kind === "NATIVE_WEB" || game.kind === "ISOLATED_WEB") {
    const bridges = target.assetPaths.filter(path => path.endsWith("/bridge.js"));
    if (bridges.length !== 1) {configurationFailure("RUNTIME_DECLARATION_INVALID");}
    resources[0].bridgeAssetPath = bridges[0];
  }
  const entryFile = "entryFile" in config.content ? config.content.entryFile : null;
  if (config.content.kind === "SINGLE_FILE" && files.some(file => file.logicalKey === entryFile && file.name.toLowerCase().endsWith(".cue"))) {
    if (!target.inputs.some(input => input.role === "game-files")) {configurationFailure("RUNTIME_CONTENT_UNSUPPORTED");}
    const others = cueFiles ? [...cueFiles] : files.filter(file => file.logicalKey !== entryFile).map(file => file.logicalKey);
    if (others.some(key => !files.some(file => file.logicalKey === key) || key === entryFile)) {configurationFailure("RUNTIME_CUE_INVALID");}
    if (others.length) {resources.push({role: "game-files", kind: "EXTERNAL_FILE_SET", ordinal: 0, files: others,
      paths: projectPaths(others, entryFile!)});}
  }
  if (parent.length > 0) {
    const input = target.inputs.find(item => item.role === "parent");
    if (!input || input.kind !== "PARENT_ARCHIVE") {configurationFailure("RUNTIME_PARENT_INVALID");}
    resources.push({role: "parent", kind: "PARENT_ARCHIVE", ordinal: 0, files: parent});
  }
  return resources;
}

function gameResource(kind: ResourceKind, config: RuntimeConfiguration, files: readonly RuntimeContentFile[]): ResourcePlan {
  const content = config.content, entry = "entryFile" in content ? content.entryFile : null;
  const plan: ResourcePlan = {role: "game", kind, ordinal: 0, files: []};
  if (entry) {plan.entryFile = entry;}
  if (content.kind === "DOS_BUNDLE") {return {...plan, files: [content.entryFile], paths: {[content.entryFile]: "game.zip"}};}
  const packed = kind === "SEEKABLE_BLOB" && content.kind === "RPG_MAKER_PROJECT";
  if (["FILE_TREE", "NATIVE_WEB", "ISOLATED_WEB"].includes(kind) || packed) {
    const root = entry?.slice(0, entry.lastIndexOf("/") + 1) ?? "";
    plan.files = files.filter(file => file.logicalKey.startsWith(root)).map(file => file.logicalKey);
    if (kind === "FILE_TREE" || packed) {
      plan.paths = projectPaths(plan.files, entry ?? "");
      if (entry) {plan.entryFile = plan.paths[entry];}
    }
    if (packed) {plan.encoding = "ZIP";}
    return plan;
  }
  if (!entry) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  return {...plan, files: [entry]};
}

function projectPaths(keys: readonly string[], entry: string): Record<string, string> {
  const root = entry.slice(0, entry.lastIndexOf("/") + 1);
  if (keys.some(key => !key.startsWith(root))) {configurationFailure("RUNTIME_PROJECT_PATH_INVALID");}
  return Object.fromEntries(keys.map(key => [key, key.slice(root.length)]));
}

/** A list uses the same identity rules without reading archives or preparing playable resources. */
export function inspectRuntimeIdentity(request: PrepareRuntimeRequest) {
  const {identity, declaration} = prepareIdentity(request);
  return {...identity, readFormats: declaration.checkpoint?.readFormats ?? []};
}

function selectedRuntimeCore(request: PrepareRuntimeRequest) {
  const directory = request.directory, selectedCore = request.coreId ?? directory.defaultCoreId;
  if (!identifier(directory.platformId) || !identifier(directory.defaultCoreId) || !identifier(selectedCore) ||
    !Array.isArray(directory.allowedCoreIds) || new Set(directory.allowedCoreIds).size !== directory.allowedCoreIds.length ||
    !directory.allowedCoreIds.every(identifier) || !directory.allowedCoreIds.includes(directory.defaultCoreId) ||
    !directory.allowedCoreIds.includes(selectedCore)) {configurationFailure("RUNTIME_CORE_UNAVAILABLE", {coreId: selectedCore});}
  return selectedCore;
}

export function validateConfiguredOptions(platformId: string, config: RuntimeConfiguration, files: readonly RuntimeContentFile[]) {
  for (const coreId of Object.keys(config.cores ?? {})) {
    const {target} = resolveRuntimeTarget(platformId, coreId, config.content);
    prepareTargetOptions(config, target, coreId, files);
  }
}
