import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {materializeFileBytes, type AdapterContentOptions} from "../provider/content-inputs.js";
import type {MameCore, MameParameters} from "./core.js";
import {profiles, validGameSize, validateGame} from "./profiles.js";
export async function mountFiles(core: Pick<MameCore, "FS">, config: MameParameters, content: AdapterContentOptions) {
  const profile = profiles[config.machine];
  if (!validGameSize(config.machine, config.game.sizeBytes) || config.bios.length !== profile.firmware.length ||
    !profile.firmware.every(bios => config.bios.filter(file => file.logicalName === bios.name && file.sizeBytes === bios.size).length === 1)) {throw new Error("MAME_CONTENT_INVALID");}
  const inputs = [config.game, ...config.bios], ready = inputs.map(() => 0);
  const total = inputs.reduce((sum, file) => sum + file.sizeBytes, 0);
  const bytes = await Promise.all(inputs.map((file, i) => materializeFileBytes(content.contentSession, file,
    content.contentSession.inputPolicy(i ? "external" : "game"), i ? "FIRMWARE" : "GAME", content.signal,
    progress => {ready[i] = progress.readyBytes; content.reportProgress?.({phase: "PROJECT_CONTENT", loadedBytes: ready.reduce((a, b) => a + b, 0), totalBytes: total});})));
  validateGame(config.machine, bytes[0]);
  core.FS.mkdirTree("/content");
  for (const bios of profile.firmware) {
    core.FS.mkdirTree(`/content/${bios.directory}`);
    core.FS.writeFile(`/content/${bios.directory}/${bios.name}`, bytes[config.bios.findIndex(file => file.logicalName === bios.name) + 1]);
  }
  core.FS.writeFile(profile.path, bytes[0]);
  // Native images are read-only. Disk II retries READ after a denied READ|WRITE.
  core.FS.chmod(profile.path, 0o444); core.FS.ignorePermissions = false;
  const command = `${profile.arguments} -rompath /content -skip_gameinfo -nothrottle`;
  core.FS.writeFile("/content/boot.cmd", new TextEncoder().encode(command));
  const identity = [config.machine, config.game.sha256, ...config.bios.map(file => `${file.logicalName}:${file.sha256}`).sort()].join("\n");
  return bytesToHex(sha256(new TextEncoder().encode(identity)));
}
