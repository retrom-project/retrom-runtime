import {arcadeROMMember, configuredMachine, type ArcadeCatalog, type ArchiveMember} from "./arcade.js";
import {arcadeAncestry} from "./arcade-ancestry.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";

export type MissingROMMember = {coreId: string; romSet: string; role: "ROM" | "PARENT" | "BIOS";
  member: string; sizeBytes: number; reason: "MISSING" | "SIZE_MISMATCH"};

/** Audit only: inspect the selected game's required payload, never every ROM in its ancestors. */
export function arcadeMissingROMMembers(coreId: string, config: RuntimeConfiguration, files: readonly RuntimeContentFile[],
  archives: Readonly<Record<string, readonly ArchiveMember[]>>, catalog: ArcadeCatalog): MissingROMMember[] {
  if (config.content.kind !== "ARCADE") {return [];}
  const entryKey = config.content.entryFile;
  const entry = files.find(file => file.logicalKey === entryKey)!;
  const romSet = configuredMachine(coreId, config, entry.name);
  const {parents, firmware} = arcadeAncestry(romSet, catalog);
  const parentIDs = new Set(parents.slice(1).filter(({machine}) => !machine.bios).map(({id}) => id));
  const selected = config.cores?.[coreId]?.parentFiles ?? [];
  const members = [...archives[entry.logicalKey] ?? [], ...files.filter(file => selected.includes(file.logicalKey) &&
    parentIDs.has(file.name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase())).flatMap(file => archives[file.logicalKey] ?? [])];
  return parents[0].machine.roms.filter(rom => !rom.optional && !firmware.some(other => sameROM(rom, other) &&
    (rom.name === other.name || rom.merge === other.name))).flatMap(rom => {
    const role = parents.slice(1).some(({machine}) => !machine.bios && machine.roms.some(other => sameROM(rom, other))) ? "PARENT" : "ROM";
    const missing = missingROMMember(coreId, romSet, role, rom, members);
    return missing ? [missing] : [];
  });
}
export function missingROMMember(coreId: string, romSet: string, role: MissingROMMember["role"],
  rom: ArcadeCatalog[string]["roms"][number], members: readonly ArchiveMember[]): MissingROMMember | null {
  if (arcadeROMMember(members, rom)) {return null;}
  return {coreId, romSet, role, member: rom.name, sizeBytes: Number(rom.size),
    reason: members.some(member => member.name === rom.name || member.name === rom.merge) ? "SIZE_MISMATCH" : "MISSING"};
}
function sameROM(left: ArcadeCatalog[string]["roms"][number], right: ArcadeCatalog[string]["roms"][number]) {
  return left.size === right.size && left.crc.toLowerCase() === right.crc.toLowerCase();
}
