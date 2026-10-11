import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import {configurationFailure} from "./validation.js";
import provenance from "./arcade-provenance.json" with {type: "json"};
import {arcadeAncestry} from "./arcade-ancestry.js";
export type ArchiveMember = {name: string; sizeBytes: number; crc32: string};
export type ArcadeMachine = {parent: string | null; bios: boolean; device?: boolean; runnable?: boolean; devices?: string[];
  roms: Array<{name: string; size: string; crc: string; sha1?: string; merge?: string; bios?: string; optional?: boolean}>};
export type ArcadeCatalog = Readonly<Record<string, ArcadeMachine>>;
export function playableArcadeMachine(machine: ArcadeMachine | undefined): machine is ArcadeMachine {
  return !!machine && !machine.bios && !machine.device && machine.runnable !== false;
}

/** Match game Parent payloads against actual members; DAT firmware is delivered independently. */
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
  const {parents, devices, firmware} = arcadeAncestry(machineId, catalog);
  for (let index = 1; index < parents.length; index++) {
    const current = parents[index - 1].machine, {id: parentId, machine: parent} = parents[index];
    if (parent.bios) {biosSets.push(parentId); continue;}
    const inherited = current.roms.filter(rom => !rom.optional &&
      (rom.merge || parent.roms.some(other => sameRom(rom, other))) &&
      !firmware.some(other => sameRom(rom, other) && (rom.name === other.name || rom.merge === other.name)));
    if (needsParent(coreId, index === 1, inherited, availableMembers)) {
      const file = files.find(item => configured.includes(item.logicalKey) && archiveId(item.name) === parentId);
      if (!file || !archives[file.logicalKey] || !inherited.every(rom => hasRom([...availableMembers, ...archives[file.logicalKey]], rom))) {missingParents.push(parentId);}
      else {parentFiles.push(file.logicalKey); availableMembers.push(...archives[file.logicalKey]);}
    }
  }
  // An embedded firmware member must not suppress the DAT's independent BIOS
  // requirement, even when its name, size and CRC match the selected core.
  biosSets.push(...devices.filter(({machine}) => machine.roms.some(rom => !rom.optional))
    .map(({id}) => id).filter(id => !biosSets.includes(id)));
  return {parentFiles, missingParents, biosSets};
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
export function arcadeROMMember(members: readonly ArchiveMember[], rom: ArcadeMachine["roms"][number]) {
  const sameSize = members.filter(member => member.sizeBytes === Number(rom.size));
  return sameSize.find(member => member.crc32.toLowerCase() === rom.crc.toLowerCase()) ??
    sameSize.find(member => member.name === rom.name || member.name === rom.merge);
}
function hasRom(members: readonly ArchiveMember[], rom: ArcadeMachine["roms"][number]) {
  return !!arcadeROMMember(members, rom);
}
