import {flycastAttachment, flycastDependencies} from "./flycast-arcade.js";
import {arcadeDependencies, configuredMachine} from "./arcade.js";
import {arcadeMedia} from "./arcade-media.js";
import {parseRuntimeConfiguration} from "./configuration.js";
import {contentHash} from "./identity.js";
import {selectedRuntimeCore, type ContentBIOSRequest} from "./prepare.js";
import {resolveRuntimeTarget} from "./catalog.js";
import {configurationFailure} from "./validation.js";
import type {RuntimeConfiguration} from "./types.js";

export type ArcadeParentRequest = ContentBIOSRequest & {attachFile?: string};

/** Parent facts and attachment share DAT/member rules without preparing a launch. */
export function arcadeParentOptions(request: ArcadeParentRequest) {
  let config = parseRuntimeConfiguration(request.config);
  const coreId = selectedRuntimeCore(request);
  contentHash(request.files, "TREE");
  const {target} = resolveRuntimeTarget(request.directory.platformId, coreId, config.content);
  if (target.contentRequirements?.kind === "FLYCAST_CARTRIDGE") {
    const platform = target.contentRequirements.platform;
    if (request.attachFile !== undefined) {config = parseRuntimeConfiguration(flycastAttachment(platform, coreId, config,
      request.files, request.flycastCatalog, request.attachFile));}
    const dependencies = flycastDependencies(platform, coreId, config, request.files, request.flycastCatalog, request.archives);
    return {coreId, parentFiles: dependencies.parentFiles, missingParents: dependencies.missingParents.map(name => `${name}.zip`),
      mediaFiles: dependencies.mediaFiles, missingMedia: dependencies.missingMedia, config};
  }
  if (config.content.kind !== "ARCADE") {configurationFailure();}
  if (!request.arcadeCatalog || !request.archives) {configurationFailure("RUNTIME_ARCADE_CATALOG_UNAVAILABLE");}
  const media = arcadeMedia(coreId, config, request.files, request.arcadeCatalog, request.chdHeaders);
  const attachMedia = request.attachFile !== undefined && /\.chd$/iu.test(request.attachFile);
  if (attachMedia && !media.mediaFiles.includes(request.attachFile!)) {configurationFailure("RUNTIME_ARCADE_DISK_INVALID");}
  if (request.attachFile !== undefined && !attachMedia) {
    const parentID = parentReferenceID(request, config, coreId);
    const core = config.cores?.[coreId] ?? {};
    const parentFiles = [...(core.parentFiles ?? []).filter(key => {
      const file = request.files.find(file => file.logicalKey === key);
      return archiveID(file?.name ?? key) !== parentID;
    }), request.attachFile];
    config = parseRuntimeConfiguration({...config, cores: {...config.cores, [coreId]: {...core, parentFiles}}});
  }
  const dependencies = arcadeDependencies(coreId, config, request.files, request.archives, request.arcadeCatalog);
  return {coreId, parentFiles: dependencies.parentFiles,
    missingParents: dependencies.missingParents.map(parent => `${parent}.zip`),
    mediaFiles: media.mediaFiles, missingMedia: media.missingMedia, config};
}

function parentReferenceID(request: ArcadeParentRequest, config: RuntimeConfiguration, coreId: string) {
  if (config.content.kind !== "ARCADE") {configurationFailure();}
  const entryFile = config.content.entryFile;
  const entry = request.files.find(file => file.logicalKey === entryFile);
  const candidate = request.files.find(file => file.logicalKey === request.attachFile);
  if (!entry || !candidate || candidate.logicalKey === entry.logicalKey || !/\.zip$/iu.test(candidate.name)) {
    configurationFailure("RUNTIME_PARENT_INVALID");
  }
  const machineID = configuredMachine(coreId, config, entry.name);
  const parentID = archiveID(candidate.name), seen = new Set([machineID]);
  let current = request.arcadeCatalog?.[machineID];
  while (current?.parent) {
    const id = current.parent;
    if (seen.has(id) || seen.size > 32) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    seen.add(id);
    current = request.arcadeCatalog?.[id];
    if (id === parentID && current && !current.bios) {return parentID;}
  }
  configurationFailure("RUNTIME_PARENT_INVALID");
}
function archiveID(name: string) {return name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase();}
