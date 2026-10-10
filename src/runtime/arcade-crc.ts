import {arcadeROMMember, configuredMachine, type ArcadeCatalog, type ArchiveMember} from "./arcade.js";
import {arcadeAncestry} from "./arcade-ancestry.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";

export type CRCWarning = {role: "ROM" | "PARENT" | "BIOS"; file: string; member: string; expectedCRC32: string; actualCRC32: string};
export function arcadeCRCWarnings(coreId: string, config: RuntimeConfiguration, files: readonly RuntimeContentFile[],
  archives: Readonly<Record<string, readonly ArchiveMember[]>>, catalog: ArcadeCatalog): CRCWarning[] {
  if (config.content.kind !== "ARCADE") {return [];}
  const entryKey = config.content.entryFile, entry = files.find(file => file.logicalKey === entryKey);
  if (!entry) {return [];}
  const machineId = configuredMachine(coreId, config, entry.name);
  if (!catalog[machineId]) {return [];}
  const {parents, devices, firmware} = arcadeAncestry(machineId, catalog), warnings: CRCWarning[] = [];
  const keys = [entry.logicalKey, ...config.cores?.[coreId]?.parentFiles ?? []];
  const available = keys.flatMap(file => (archives[file] ?? []).map(member => ({...member, file})));
  for (const {machine} of [...parents, ...devices]) {
    for (const rom of machine.roms) {
      const member = arcadeROMMember(available, rom) as (ArchiveMember & {file: string}) | undefined;
      if (!member || member.crc32.toLowerCase() === rom.crc.toLowerCase()) {continue;}
      const bios = firmware.some(other => other.size === rom.size && other.crc === rom.crc &&
        (other.name === rom.name || other.name === rom.merge));
      const warning: CRCWarning = {role: bios ? "BIOS" : member.file === entry.logicalKey ? "ROM" : "PARENT",
        file: member.file, member: member.name, expectedCRC32: rom.crc.toLowerCase(), actualCRC32: member.crc32.toLowerCase()};
      if (!warnings.some(other => other.file === warning.file && other.member === warning.member && other.expectedCRC32 === warning.expectedCRC32)) {
        warnings.push(warning);
      }
    }
  }
  return warnings;
}
