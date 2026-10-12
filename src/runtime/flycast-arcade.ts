import type {CRCWarning} from "./arcade-crc.js";
import type {ArchiveMember} from "./arcade.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import {configurationFailure, logicalPath} from "./validation.js";

export type FlycastMachine = {name: string; parent: string | null; platform: string; mediaType: string; disc: string | null;
  files: Array<{name: string; sizeBytes: number; crc32: string | null; optional: boolean}>};
type Evidence = Readonly<Record<string, readonly ArchiveMember[]>>;
type LocatedMember = ArchiveMember & {file: string};

/** Interpret only the table emitted by the selected compiled core. */
export function flycastMachine(platform: string, file: RuntimeContentFile, catalog: readonly FlycastMachine[] | undefined) {
  if (!catalog) {configurationFailure("RUNTIME_FLYCAST_CATALOG_UNAVAILABLE");}
  const name = archiveName(file.name);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name) || !/\.zip$/iu.test(file.name) || name.includes("..")) {
    configurationFailure("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED");
  }
  const matches = catalog.filter(machine => machine.name === name);
  if (matches.length !== 1) {configurationFailure("RUNTIME_FLYCAST_MACHINE_UNKNOWN", {machine: name});}
  const machine = matches[0];
  if (machine.platform !== platform) {configurationFailure("RUNTIME_FLYCAST_PLATFORM_MISMATCH", {machine: name});}
  if (!(machine.mediaType === "CARTRIDGE" && machine.disc === null ||
    machine.mediaType === "GDROM" && machine.disc && logicalPath(machine.disc) && !machine.disc.includes("/"))) {
    configurationFailure("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED", {machine: name});
  }
  return machine;
}

/** The native loader opens the direct named parent. A complete ZIP needs no parent. */
export function flycastDependencies(platform: string, coreId: string, config: RuntimeConfiguration,
  files: readonly RuntimeContentFile[], catalog: readonly FlycastMachine[] | undefined, archives: Evidence | undefined) {
  if (!("entryFile" in config.content)) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  const entryFile = config.content.entryFile;
  const entry = files.find(file => file.logicalKey === entryFile);
  if (!entry) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  const machine = flycastMachine(platform, entry, catalog);
  const members = archives?.[entry.logicalKey];
  if (!members) {configurationFailure("RUNTIME_ARCHIVE_EVIDENCE_REQUIRED");}
  const selected = config.cores?.[coreId]?.parentFiles ?? [];
  const parents = files.filter(file => selected.includes(file.logicalKey) && archiveName(file.name) === machine.parent);
  if (parents.length > 1 || selected.some(key => !parents.some(file => file.logicalKey === key))) {
    configurationFailure("RUNTIME_PARENT_INVALID");
  }
  const available: LocatedMember[] = members.map(member => ({...member, file: entry.logicalKey}));
  for (const parent of parents) {available.push(...(archives?.[parent.logicalKey] ?? []).map(member => ({...member, file: parent.logicalKey})));}
  const missing = machine.files.filter(expected => !expected.optional && !findMember(available, expected));
  const parentMachine = catalog?.find(parent => parent.name === machine.parent);
  const inherited = missing.filter(expected => parentMachine?.files.some(parent => sameMember(expected, parent)));
  const missingParents = inherited.length && machine.parent ? [machine.parent] : [];
  const missingROMs = missing.filter(expected => !inherited.includes(expected)).map(expected => expected.name);
  const crcWarnings = machine.files.flatMap(expected => {
    const member = findMember(available, expected);
    return expected.crc32 && member && expected.crc32.toLowerCase() !== member.crc32.toLowerCase()
      ? [{role: member.file === entry.logicalKey ? "ROM" : "PARENT", file: member.file, member: member.name,
        expectedCRC32: expected.crc32.toLowerCase(), actualCRC32: member.crc32.toLowerCase()} satisfies CRCWarning] : [];
  });
  const parentFiles = parents.filter(parent => machine.files.some(expected => findMember(available, expected)?.file === parent.logicalKey))
    .map(parent => parent.logicalKey);
  const media = flycastMedia(machine, entry, files);
  return {machine, parentFiles, missingParents, missingROMs, biosSets: [], crcWarnings, ...media};
}

/** ZIP/PIC, optional inherited cartridge members, and a GD-ROM image have distinct roles. */
export function requireFlycastDependencies(result: ReturnType<typeof flycastDependencies>) {
  if (result.missingROMs.length) {configurationFailure("RUNTIME_FLYCAST_ROM_MISSING",
    {machine: result.machine.name, members: result.missingROMs.join(",")});}
  if (result.missingParents.length) {configurationFailure("RUNTIME_PARENT_MISSING", {parents: result.missingParents.join(",")});}
  if (result.missingMedia.length) {configurationFailure("RUNTIME_FLYCAST_DISC_MISSING", {files: result.missingMedia.join(",")});}
}

export function flycastMedia(machine: FlycastMachine, entry: RuntimeContentFile, files: readonly RuntimeContentFile[]) {
  if (!machine.disc) {return {mediaFiles: [] as string[], missingMedia: [] as string[], mediaPaths: {} as Record<string, string>};}
  const expected = `${machine.name}/${machine.disc}.chd`, root = entry.logicalKey.slice(0, entry.logicalKey.lastIndexOf("/") + 1);
  const candidates = files.filter(file => file.logicalKey.startsWith(root) && file.name.split("/").at(-1)!.toLowerCase() === `${machine.disc}.chd`);
  const exact = candidates.find(file => file.logicalKey === root + expected) ??
    candidates.find(file => machine.parent && file.logicalKey === `${root}${machine.parent}/${machine.disc}.chd`);
  if (!exact && candidates.length > 1) {configurationFailure("RUNTIME_FLYCAST_DISC_AMBIGUOUS", {file: expected});}
  const disc = exact ?? candidates[0];
  return disc ? {mediaFiles: [disc.logicalKey], missingMedia: [], mediaPaths: {[disc.logicalKey]: expected}}
    : {mediaFiles: [], missingMedia: [expected], mediaPaths: {}};
}

/** Discovery is advisory: the Host copies available dependencies and leaves missing ones for review. */
export function flycastContentReferences(machine: FlycastMachine, entry: RuntimeContentFile, members: readonly ArchiveMember[],
  catalog: readonly FlycastMachine[]) {
  const root = entry.logicalKey.slice(0, entry.logicalKey.lastIndexOf("/") + 1);
  const names = machine.disc ? [`${machine.name}/${machine.disc}.chd`,
    ...(machine.parent ? [`${machine.parent}/${machine.disc}.chd`] : [])] : [];
  const parent = catalog.find(item => item.name === machine.parent);
  if (machine.parent && machine.files.some(expected => !expected.optional && !findMember(members, expected) &&
    parent?.files.some(other => sameMember(expected, other)))) {names.push(`${machine.parent}.zip`);}
  return names.map(relativePath => ({logicalKey: root + relativePath, relativeTo: entry.logicalKey, relativePath, optional: true}));
}

export function flycastAttachment(platform: string, coreId: string, config: RuntimeConfiguration,
  files: readonly RuntimeContentFile[], catalog: readonly FlycastMachine[] | undefined, attachFile: string) {
  if (!("entryFile" in config.content)) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  const entryFile = config.content.entryFile;
  const entry = files.find(file => file.logicalKey === entryFile);
  const candidate = files.find(file => file.logicalKey === attachFile);
  if (!entry || !candidate || candidate.logicalKey === entry.logicalKey) {configurationFailure("RUNTIME_PARENT_INVALID");}
  const machine = flycastMachine(platform, entry, catalog);
  if (machine.disc && candidate.name.split("/").at(-1)!.toLowerCase() === `${machine.disc}.chd`) {return config;}
  if (!machine.parent || !/\.zip$/iu.test(candidate.name) || archiveName(candidate.name) !== machine.parent) {
    configurationFailure("RUNTIME_PARENT_INVALID");
  }
  const core = config.cores?.[coreId] ?? {};
  return {...config, cores: {...config.cores, [coreId]: {...core,
    parentFiles: [...(core.parentFiles ?? []).filter(key => archiveName(files.find(file => file.logicalKey === key)?.name ?? key) !== machine.parent), attachFile]}}};
}
function archiveName(name: string) {return name.split("/").at(-1)!.replace(/\.zip$/iu, "").toLowerCase();}
function sameMember(left: FlycastMachine["files"][number], right: FlycastMachine["files"][number]) {
  return left.sizeBytes === right.sizeBytes && (left.name === right.name || left.crc32 !== null && left.crc32 === right.crc32);
}
function findMember<T extends ArchiveMember>(members: readonly T[], expected: FlycastMachine["files"][number]) {
  return members.find(member => member.sizeBytes === expected.sizeBytes && expected.crc32 !== null && member.crc32.toLowerCase() === expected.crc32.toLowerCase()) ??
    members.find(member => member.name === expected.name && member.sizeBytes === expected.sizeBytes);
}
