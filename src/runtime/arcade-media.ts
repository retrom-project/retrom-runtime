import {configuredMachine, type ArcadeCatalog, type ArcadeDisk} from "./arcade.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import {configurationFailure, logicalPath} from "./validation.js";

export type CHDHeader = {sha1: string; parentSHA1: string | null};
export type CHDHeaders = Readonly<Record<string, CHDHeader>>;

/** DAT disk facts, including clone/parent media, stay independent of source layout. */
export function arcadeDiskRequirements(machine: string, catalog: ArcadeCatalog): {path: string; disk: ArcadeDisk}[] {
  const seen = new Set<string>();
  let current = machine;
  while (current) {
    if (seen.has(current) || seen.size >= 32) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    seen.add(current);
    const record = catalog[current];
    if (!record || record.bios) {return [];}
    if (record.disks?.length) {
      return record.disks.map(disk => {
        const path = `${machine}/${disk.name}.chd`;
        if (!logicalPath(path) || disk.name.includes("/") || disk.sha1 !== null && !/^[0-9a-f]{40}$/iu.test(disk.sha1)) {
          configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");
        }
        return {path, disk};
      });
    }
    current = record.parent ?? "";
  }
  return [];
}

export function arcadeMedia(coreId: string, config: RuntimeConfiguration, files: readonly RuntimeContentFile[],
  catalog: ArcadeCatalog, headers: CHDHeaders = {}) {
  const result = {mediaFiles: [] as string[], missingMedia: [] as string[], mediaPaths: {} as Record<string, string>};
  if (coreId !== "mame_arcade" || config.content.kind !== "ARCADE") {return result;}
  const entryFile = config.content.entryFile, entry = files.find(file => file.logicalKey === entryFile);
  if (!entry) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  const machine = configuredMachine(coreId, config, entry.name);
  for (const {path, disk} of arcadeDiskRequirements(machine, catalog)) {
    const candidates = files.filter(file => file.logicalKey !== entryFile && disk.sha1 && headers[file.logicalKey]?.sha1 === disk.sha1);
    candidates.sort((a, b) => Number(Boolean(headers[a.logicalKey].parentSHA1)) - Number(Boolean(headers[b.logicalKey].parentSHA1)) ||
      Number(b.logicalKey === path) - Number(a.logicalKey === path) ||
      (a.logicalKey < b.logicalKey ? -1 : a.logicalKey > b.logicalKey ? 1 : 0));
    const selected = candidates[0];
    if (!selected) {if (!disk.optional) {result.missingMedia.push(path);} continue;}
    if (headers[selected.logicalKey].parentSHA1) {
      configurationFailure("RUNTIME_ARCADE_DISK_PARENT_REQUIRED", {file: path, sha1: headers[selected.logicalKey].parentSHA1!});
    }
    if (result.mediaPaths[selected.logicalKey] && result.mediaPaths[selected.logicalKey] !== path) {
      configurationFailure("RUNTIME_ARCADE_DISK_AMBIGUOUS", {file: path});
    }
    result.mediaFiles.push(selected.logicalKey); result.mediaPaths[selected.logicalKey] = path;
  }
  return result;
}

export function requireArcadeMedia(media: ReturnType<typeof arcadeMedia>) {
  if (media.missingMedia.length) {configurationFailure("RUNTIME_ARCADE_DISK_MISSING", {files: media.missingMedia.join(",")});}
}

/** Header identity is not an integrity audit of all compressed data blocks. */
export function parseCHDHeader(bytes: Uint8Array, sizeBytes: number): CHDHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes.length >= 16 ? view.getUint32(12) : 0;
  const layout = ({3: [120, 80, 100], 4: [108, 48, 68], 5: [124, 84, 104]} as Record<number, number[]>)[version];
  if (!layout || bytes.length < layout[0] || sizeBytes <= layout[0] || view.getUint32(8) !== layout[0] ||
    new TextDecoder().decode(bytes.subarray(0, 8)) !== "MComprHD") {configurationFailure("RUNTIME_ARCADE_DISK_INVALID");}
  validateCHDGeometry(view, version, layout[0], sizeBytes);
  const hex = (offset: number) => Array.from(bytes.subarray(offset, offset + 20), value => value.toString(16).padStart(2, "0")).join("");
  const sha1 = hex(layout[1]), parent = hex(layout[2]);
  if (/^0+$/u.test(sha1)) {configurationFailure("RUNTIME_ARCADE_DISK_INVALID");}
  return {sha1, parentSHA1: /^0+$/u.test(parent) ? null : parent};
}

function validateCHDGeometry(view: DataView, version: number, headerBytes: number, sizeBytes: number) {
  const logical = view.getBigUint64(version === 5 ? 32 : 28),
    hunk = view.getUint32(version === 3 ? 76 : version === 4 ? 44 : 56);
  if (!Number.isSafeInteger(sizeBytes) || logical < 1n || logical > BigInt(Number.MAX_SAFE_INTEGER) || hunk < 1 || hunk > 524288) {
    configurationFailure("RUNTIME_ARCADE_DISK_INVALID");
  }
  validateCHDOffsets(view, version, headerBytes, sizeBytes);
  if (version === 5) {
    const unit = view.getUint32(60);
    if (!unit || unit > hunk || hunk % unit) {configurationFailure("RUNTIME_ARCADE_DISK_INVALID");}
  } else if (BigInt(view.getUint32(24)) !== (logical + BigInt(hunk) - 1n) / BigInt(hunk)) {
    configurationFailure("RUNTIME_ARCADE_DISK_INVALID");
  }
}

function validateCHDOffsets(view: DataView, version: number, headerBytes: number, sizeBytes: number) {
  const offsets = version === 5 ? [40, 48] : [36];
  for (const offset of offsets) {
    const position = view.getBigUint64(offset);
    if (position !== 0n && (position < BigInt(headerBytes) || position >= BigInt(sizeBytes))) {
      configurationFailure("RUNTIME_ARCADE_DISK_INVALID");
    }
  }
}
