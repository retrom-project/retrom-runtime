import catalog from "./bios-catalog.json" with {type: "json"};
import {runtimeBindings} from "./catalog.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import {configurationFailure} from "./validation.js";
import {canonicalPath} from "../content-io/source.js";

export type BIOSRequirement = {
  requirementKey: string; coreId: string; providerId: string; targetId: string;
  logicalName: string; required: boolean; condition: string; sizeBytes: number | null;
  md5: string | null; sha256: string | null;
  delivery: "BIOS_BUNDLE" | "EXTERNAL_FILE"; virtualPath: string | null;
  activationOptions: Readonly<Record<string, string>>;
  members?: readonly {name: string; sizeBytes: number; crc32: string; sha1: string; required: boolean}[];
};

/** Requirements are runtime facts; installation IDs never enter a Game's configuration. */
export function biosCatalog(): BIOSRequirement[] {
  return catalog.flatMap(item => runtimeBindings.filter(binding => binding.coreId === item.coreId &&
    (!("providerID" in item) || binding.providerId === item.providerID) &&
    (!("targetID" in item) || binding.targetId === item.targetID)).map(binding => ({
      requirementKey: "requirementKey" in item ? String(item.requirementKey) : `${binding.providerId}/${binding.targetId}/${item.logicalName}`,
      coreId: item.coreId, providerId: binding.providerId, targetId: binding.targetId,
      logicalName: item.logicalName, required: item.mode !== "OPTIONAL", condition: item.condition,
      sizeBytes: item.sizeBytes, md5: item.md5, sha256: item.sha256,
      delivery: item.delivery as "BIOS_BUNDLE" | "EXTERNAL_FILE", virtualPath: publicFirmwarePath(item.virtualPath),
      activationOptions: item.activationOptions as Readonly<Record<string, string>>,
      ...("members" in item ? {members: item.members} : {}),
    })));
}

/** Manifest locations belong to the core FS; resource paths use the public relative grammar. */
function publicFirmwarePath(path: string | null): string | null {
  if (path === null) {return null;}
  const relative = path.startsWith("/") ? path.slice(1) : path;
  if (!canonicalPath(relative)) {configurationFailure("RUNTIME_DECLARATION_INVALID");}
  return relative;
}

export function resolveBIOSRequirements(input: {providerId: string; targetId: string; config: RuntimeConfiguration;
  files: readonly RuntimeContentFile[]; firmwareEvidence?: {psxRegion?: import("./psx.js").PSXRegion | null}}): BIOSRequirement[] {
  const entry = "entryFile" in input.config.content ? input.config.content.entryFile : null;
  const name = input.files.find(file => file.logicalKey === entry)?.name ?? "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  const region = input.firmwareEvidence?.psxRegion;
  if (region !== undefined && region !== null && !["JP", "US", "EU"].includes(region)) {configurationFailure("RUNTIME_EVIDENCE_INVALID");}
  return biosCatalog().filter(item => item.providerId === input.providerId && item.targetId === input.targetId &&
    conditionApplies(item.condition, extension, input.config, region)).map(item =>
    item.condition.startsWith("PSX_REGION_") && !region ? {...item, required: false} : item);
}

const conditionalExtensions: Readonly<Record<string, readonly string[]>> = {
  SEGA_CD_CONTENT: [".chd", ".cue", ".iso"], PCE_CD_CONTENT: [".chd", ".cue", ".iso"],
  AMIGA_CD32_CONTENT: [".chd", ".iso", ".nrg"],
  AMIGA_COMPUTER_CONTENT: [".adf", ".adz", ".dms", ".ipf", ".hdf", ".hdz", ".lha", ".zip"],
  FDS_CONTENT: [".fds"], GB_CONTENT: [".gb", ".dmg"], GBC_CONTENT: [".gbc"], GBA_CONTENT: [".gba"],
};
function conditionApplies(condition: string, extension: string, config: RuntimeConfiguration, psxRegion?: import("./psx.js").PSXRegion | null): boolean {
  if (["", "SNES_BSX_FIRMWARE", "SNES_SUFAMI_FIRMWARE"].includes(condition)) {return true;}
  const extensions = conditionalExtensions[condition];
  if (extensions) {return extensions.includes(extension);}
  if (condition === "GAME_GENIE_ADDON_MODE") {return config.cores?.fceumm?.options?.gameGenie === true;}
  if (condition === "MGBA_SGB_MODEL") {return config.cores?.mgba?.options?.model === "SGB";}
  if (["PSX_REGION_JP", "PSX_REGION_US", "PSX_REGION_EU"].includes(condition)) {return !psxRegion || condition === `PSX_REGION_${psxRegion}`;}
  configurationFailure("RUNTIME_DECLARATION_INVALID", {condition});
}

/** File scanning installs only a uniquely identified missing requirement. */
export function identifyBIOSFile(input: {sizeBytes: number; sha256: string; md5: string; name?: string}, requirements: readonly BIOSRequirement[]) {
  return requirements.filter(requirement => (requirement.sizeBytes === null || requirement.sizeBytes === input.sizeBytes) &&
    (requirement.sha256 !== null ? requirement.sha256 === input.sha256 : requirement.md5 !== null && requirement.md5 === input.md5 ||
      requirement.sha256 === null && requirement.md5 === null && input.name === requirement.logicalName));
}

/** Firmware ZIP sets are declared by the matching core DAT, rather than guessed from a filename. */
export function arcadeBIOSRequirements(coreId: string, games: import("./arcade.js").ArcadeCatalog,
  selected?: readonly string[]): BIOSRequirement[] {
  const binding = runtimeBindings.find(item => item.coreId === coreId && item.contentKinds.includes("ARCADE"));
  if (!binding) {return [];}
  return Object.entries(games).filter(([name, machine]) => (machine.bios || machine.device && machine.roms.some(rom => !rom.optional)) && (!selected || selected.includes(name)))
    .map(([name, machine]) => ({requirementKey: `${binding.providerId}/${binding.targetId}/${name}.zip`,
      coreId, providerId: binding.providerId, targetId: binding.targetId, logicalName: `${name}.zip`, required: true,
      condition: "ARCADE_BIOS", sizeBytes: null, md5: null, sha256: null, delivery: "EXTERNAL_FILE" as const,
      virtualPath: coreId === "mame_arcade" ? `content/roms/${name}.zip` : `${name}.zip`, activationOptions: {}, members: machine.roms.map(rom => ({name: rom.name,
        sizeBytes: Number(rom.size), crc32: rom.crc, sha1: rom.sha1 ?? "", required: !rom.optional}))}));
}
