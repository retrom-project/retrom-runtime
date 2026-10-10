import type {CRCWarning} from "./arcade-crc.js";
import type {ArchiveMember} from "./arcade.js";
import type {RuntimeContentFile} from "./types.js";
import {configurationFailure} from "./validation.js";

export type FlycastMachine = {name: string; parent: string | null; platform: string; mediaType: string; disc: string | null;
  files: Array<{name: string; sizeBytes: number; crc32: string | null; optional: boolean}>};

/** The core's compiled table is the authority; an EEPROM or arbitrary ZIP is not a cartridge. */
export function validateFlycastCartridge(platform: string, file: RuntimeContentFile,
  catalog: readonly FlycastMachine[] | undefined, members: readonly ArchiveMember[] | undefined) {
  if (!catalog) {configurationFailure("RUNTIME_FLYCAST_CATALOG_UNAVAILABLE");}
  const name = file.name.split("/").at(-1)!;
  if (!/^[a-z0-9][a-z0-9._-]*\.zip$/iu.test(name) || name.includes("..")) {
    configurationFailure("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED");
  }
  const id = name.slice(0, -4).toLowerCase(), machines = catalog.filter(machine => machine.name === id);
  if (machines.length !== 1) {configurationFailure("RUNTIME_FLYCAST_MACHINE_UNKNOWN", {machine: id});}
  const machine = machines[0];
  if (machine.platform !== platform) {configurationFailure("RUNTIME_FLYCAST_PLATFORM_MISMATCH", {machine: id});}
  if (machine.mediaType !== "CARTRIDGE" || machine.disc !== null) {configurationFailure("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED", {machine: id});}
  if (!members) {configurationFailure("RUNTIME_ARCHIVE_EVIDENCE_REQUIRED");}
  const missing = machine.files.filter(expected => !expected.optional && !members.some(member =>
    member.name === expected.name && member.sizeBytes === expected.sizeBytes));
  if (missing.length) {configurationFailure("RUNTIME_FLYCAST_ROM_MISSING", {machine: id, members: missing.map(file => file.name).join(",")});}
  return machine.files.flatMap(expected => {
    const member = members.find(member => member.name === expected.name && member.sizeBytes === expected.sizeBytes);
    return expected.crc32 && member && expected.crc32.toLowerCase() !== member.crc32.toLowerCase()
      ? [{role: "ROM", file: file.logicalKey, member: member.name, expectedCRC32: expected.crc32.toLowerCase(),
        actualCRC32: member.crc32.toLowerCase()} satisfies CRCWarning] : [];
  });
}
