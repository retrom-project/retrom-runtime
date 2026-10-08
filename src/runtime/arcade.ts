import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import {configurationFailure} from "./validation.js";
import provenance from "./arcade-provenance.json" with {type: "json"};
export type ArchiveMember = {name: string; sizeBytes: number; crc32: string};
export type ArcadeMachine = {parent: string | null; bios: boolean; device?: boolean; runnable?: boolean; devices?: string[];
  roms: Array<{name: string; size: string; crc: string; sha1?: string; merge?: string; bios?: string; optional?: boolean}>};
export type ArcadeCatalog = Readonly<Record<string, ArcadeMachine>>;
export function playableArcadeMachine(machine: ArcadeMachine | undefined): machine is ArcadeMachine {
  return !!machine && !machine.bios && !machine.device && machine.runnable !== false;
}

/** Match DAT facts against actual members, so merged sets do not require redundant parent archives. */
export function arcadeDependencies(coreId: string, config: RuntimeConfiguration, files: readonly RuntimeContentFile[],
  archives: Readonly<Record<string, readonly ArchiveMember[]>>, catalog: ArcadeCatalog) {
  if (config.content.kind !== "ARCADE") {return {parentFiles: [], missingParents: [], biosSets: []};}
  const entryKey = config.content.entryFile;
  const entry = files.find(file => file.logicalKey === entryKey);
  if (!entry) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  const machineId = configuredMachine(coreId, config, entry.name), machine = catalog[machineId];
  if (!playableArcadeMachine(machine)) {configurationFailure("RUNTIME_ARCADE_MACHINE_UNKNOWN", {machine: machineId});}
  const gameMembers = archives[entry.logicalKey];
  if (!gameMembers) {configurationFailure("RUNTIME_ARCHIVE_EVIDENCE_REQUIRED");}
  const configured = config.cores?.[coreId]?.parentFiles ?? [];
  const parentFiles: string[] = [], missingParents: string[] = [], biosSets: string[] = [];
  const availableMembers = [...gameMembers];
  let current = machine;
  const seen = new Set([machineId]);
  while (current.parent) {
    const parentId = current.parent, parent = catalog[parentId];
    if (!parent || seen.has(parentId) || seen.size > 32) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    seen.add(parentId);
    if (parent.bios) {biosSets.push(parentId); current = parent; continue;}
    const inherited = current.roms.filter(rom => !rom.optional && (rom.merge || parent.roms.some(other => sameRom(rom, other))));
    if (needsParent(coreId, current === machine, inherited, availableMembers)) {
      const file = files.find(item => configured.includes(item.logicalKey) && archiveId(item.name) === parentId);
      if (!file || !archives[file.logicalKey] || !inherited.every(rom => hasRom([...availableMembers, ...archives[file.logicalKey]], rom))) {missingParents.push(parentId);}
      else {parentFiles.push(file.logicalKey); availableMembers.push(...archives[file.logicalKey]);}
    }
    current = parent;
  }
  const deviceRoots = [...seen].flatMap(name => catalog[name].devices ?? []);
  biosSets.push(...requiredDevices(deviceRoots, catalog, availableMembers).filter(name => !biosSets.includes(name)));
  return {parentFiles, missingParents, biosSets};
}
function requiredDevices(roots: string[], catalog: ArcadeCatalog, members: ArchiveMember[]): string[] {
  const visited = new Set<string>(), visiting = new Set<string>(), required: string[] = [];
  function deviceDependency(name: string) {
    if (visiting.has(name)) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    if (visited.has(name)) {return;}
    const device = catalog[name];
    if (!device?.device || visiting.size > 128) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    visiting.add(name);
    for (const child of device.devices ?? []) {deviceDependency(child);}
    visiting.delete(name); visited.add(name);
    if (device.roms.some(rom => !rom.optional && !hasRom(members, rom))) {required.push(name);}
  }
  for (const name of roots) {deviceDependency(name);}
  return required;
}
export function configuredMachine(coreId: string, config: RuntimeConfiguration, name: string) {
  const explicit = config.cores?.[coreId]?.options?.machine;
  return coreId === "mame_arcade" && typeof explicit === "string" ? explicit : archiveId(name);
}
function needsParent(coreId: string, direct: boolean, inherited: ArcadeMachine["roms"], members: ArchiveMember[]) {
  // The pinned CPS2 loader opens its named parent archive before looking at clone members.
  const required = direct && provenance.some(source => source.coreId === coreId &&
    "requiresParentArchive" in source && source.requiresParentArchive === true);
  return required || !inherited.every(rom => hasRom(members, rom));
}
function archiveId(name: string) {return name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase();}
function sameRom(left: ArcadeMachine["roms"][number], right: ArcadeMachine["roms"][number]) {
  return left.size === right.size && left.crc.toLowerCase() === right.crc.toLowerCase();
}
function hasRom(members: readonly ArchiveMember[], rom: ArcadeMachine["roms"][number]) {
  return members.some(member => member.sizeBytes === Number(rom.size) && member.crc32.toLowerCase() === rom.crc.toLowerCase());
}
