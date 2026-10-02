import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {materializeFileBytes, type AdapterContentOptions} from "../provider/content-inputs.js";
import type {MameCore, MameParameters} from "./core.js";
import {profiles, validGameSize, validateGame} from "./profiles.js";
import {parentStateIdentity} from "./state.js";
import {unzipSync} from "fflate";
export async function mountFiles(core: Pick<MameCore, "FS">, config: MameParameters, content: AdapterContentOptions) {
  if (config.arcade) {return mountArcadeFiles(core, config, content);}
  const profile = profiles[config.machine];
  if (!validGameSize(config.machine, config.game.sizeBytes) || config.bios.length !== profile.firmware.length ||
    !profile.firmware.every(bios => config.bios.filter(file => file.logicalName === bios.name && file.sizeBytes === bios.size).length === 1)) {throw new Error("MAME_CONTENT_INVALID");}
  const inputs = [config.game, ...config.bios], ready = inputs.map(() => 0);
  const total = inputs.reduce((sum, file) => sum + file.sizeBytes, 0);
  const bytes = await Promise.all(inputs.map((file, i) => materializeFileBytes(content.contentSession, file,
    content.contentSession.inputPolicy(i ? "external" : "game"), i ? "FIRMWARE" : "GAME", content.signal,
    progress => {ready[i] = progress.readyBytes; content.reportProgress?.({phase: "PROJECT_CONTENT", loadedBytes: ready.reduce((a, b) => a + b, 0), totalBytes: total});})));
  const game = cartridgeBytes(config.machine, bytes[0]);
  validateGame(config.machine, game);
  core.FS.mkdirTree("/content");
  for (const bios of profile.firmware) {
    core.FS.mkdirTree(`/content/${bios.directory}`);
    core.FS.writeFile(`/content/${bios.directory}/${bios.name}`, bytes[config.bios.findIndex(file => file.logicalName === bios.name) + 1]);
  }
  core.FS.writeFile(profile.path, game);
  // Native images are read-only. Disk II retries READ after a denied READ|WRITE.
  core.FS.chmod(profile.path, 0o444); core.FS.ignorePermissions = false;
  const command = `${profile.arguments} -rompath /content -skip_gameinfo -nothrottle`;
  core.FS.writeFile("/content/boot.cmd", new TextEncoder().encode(command));
  const identity = [config.machine, config.game.sha256, ...config.bios.map(file => `${file.logicalName}:${file.sha256}`).sort()].join("\n");
  return bytesToHex(sha256(new TextEncoder().encode(identity)));
}

function cartridgeBytes(machine: string, bytes: Uint8Array): Uint8Array {
  if (machine !== "sg1000" && machine !== "coleco") {return bytes;}
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) {return bytes;}
  let entries: Record<string, Uint8Array>, count = 0;
  try {entries = unzipSync(bytes, {filter: entry => {
    count++;
    if (count > 1 || entry.originalSize > 65536) {throw new Error("MAME_CONTENT_INVALID");}
    return true;
  }});} catch {throw new Error("MAME_CONTENT_INVALID");}
  const files = Object.entries(entries);
  if (files.length !== 1) {throw new Error("MAME_CONTENT_INVALID");}
  const [name, game] = files[0];
  const extension = machine === "sg1000" ? ".sg" : ".col";
  if (name.length > 255 || name.includes("/") || name.includes("\\") || !name.toLowerCase().endsWith(extension)) {
    throw new Error("MAME_CONTENT_INVALID");
  }
  return game;
}

async function mountArcadeFiles(core: Pick<MameCore, "FS">, config: Extract<MameParameters, {arcade: true}>, content: AdapterContentOptions) {
  if (!/^[a-z0-9_]{1,32}$/u.test(config.machine) || config.game.sizeBytes < 22 || config.game.sizeBytes > 128 * 1024 * 1024) {
    throw new Error("MAME_CONTENT_INVALID");
  }
  if (config.deviceBios.length > 1 || config.deviceBios.some(file => file.logicalName !== "epr-18022.ic2" ||
    file.virtualPath !== "content/roms/segabill/epr-18022.ic2" || file.sizeBytes !== 65536)) {
    throw new Error("MAME_CONTENT_INVALID");
  }
  const game = await materializeFileBytes(content.contentSession, config.game, content.contentSession.inputPolicy("game"),
    "GAME", content.signal);
  const archives = new Map<string, Uint8Array>([[`${config.machine}.zip`, game]]);
  let parentIdentity = "";
  if (config.parent) {
    const parent = await materializeFileBytes(content.contentSession, config.parent, content.contentSession.inputPolicy("parent"),
      "GAME", content.signal, progress => content.reportProgress?.({phase: "PROJECT_CONTENT",
        loadedBytes: progress.readyBytes, totalBytes: progress.totalBytes}));
    parentIdentity = parentStateIdentity(addArcadeArchives(archives, parent));
  }
  if (config.bios) {
    const bios = await materializeFileBytes(content.contentSession, config.bios, content.contentSession.inputPolicy("bios"),
      "FIRMWARE", content.signal, progress => content.reportProgress?.({phase: "PROJECT_CONTENT",
        loadedBytes: progress.readyBytes, totalBytes: progress.totalBytes}));
    addArcadeArchives(archives, bios);
  }
  core.FS.mkdirTree("/content/roms");
  for (const [name, bytes] of archives) {core.FS.writeFile(`/content/roms/${name}`, bytes);}
  for (const file of config.deviceBios) {
    const bytes = await materializeFileBytes(content.contentSession, file, content.contentSession.inputPolicy("external"),
      "FIRMWARE", content.signal);
    core.FS.mkdirTree("/content/roms/segabill");
    core.FS.writeFile(`/content/roms/segabill/${file.logicalName}`, bytes);
  }
  core.FS.writeFile("/content/boot.cmd", new TextEncoder().encode(`${config.machine} -rompath /content/roms -skip_gameinfo -nothrottle`));
  const identity = [config.machine, config.game.sha256, parentIdentity, config.bios?.sha256 ?? "",
    ...config.deviceBios.map(file => file.sha256)].join("\n");
  return bytesToHex(sha256(new TextEncoder().encode(identity)));
}

function addArcadeArchives(archives: Map<string, Uint8Array>, bytes: Uint8Array) {
  let entries: Record<string, Uint8Array>, expanded = 0, count = 0;
  try {entries = unzipSync(bytes, {filter: entry => {
    expanded += entry.originalSize; count++;
    if (expanded > 128 * 1024 * 1024 || count > 64) {throw new Error("MAME_CONTENT_INVALID");}
    return true;
  }});} catch {throw new Error("MAME_CONTENT_INVALID");}
  for (const [name, contents] of Object.entries(entries)) {
    if (!/^[a-z0-9_]{1,32}\.zip$/u.test(name) || archives.has(name) || contents.length > 128 * 1024 * 1024) {
      throw new Error("MAME_CONTENT_INVALID");
    }
    archives.set(name, contents);
  }
  return entries;
}
