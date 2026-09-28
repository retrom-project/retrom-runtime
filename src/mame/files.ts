import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {materializeFileBytes, type AdapterContentOptions} from "../provider/content-inputs.js";
import type {MameCore, MameParameters} from "./core.js";
export const biosNames = ["341-0011.d0", "341-0012.d8", "341-0013.e0", "341-0014.e8", "341-0015.f0", "341-0020-00.f8", "341-0036.chr", "341-0027-a.p5", "341-0028-a.rom"];
const peripheralDirectories: Record<string, string> = {"341-0027-a.p5": "a2diskiing", "341-0028-a.rom": "d2fdc"};
export async function mountFiles(core: Pick<MameCore, "FS">, config: MameParameters, content: AdapterContentOptions) {
  if (config.game.sizeBytes !== 143360 || config.bios.length !== biosNames.length ||
    !biosNames.every(name => config.bios.filter(file => file.logicalName === name).length === 1)) {throw new Error("MAME_CONTENT_INVALID");}
  const inputs = [config.game, ...config.bios], ready = inputs.map(() => 0);
  const total = inputs.reduce((sum, file) => sum + file.sizeBytes, 0);
  const bytes = await Promise.all(inputs.map((file, i) => materializeFileBytes(content.contentSession, file,
    content.contentSession.inputPolicy(i ? "external" : "game"), i ? "FIRMWARE" : "GAME", content.signal,
    progress => {ready[i] = progress.readyBytes; content.reportProgress?.({phase: "PROJECT_CONTENT", loadedBytes: ready.reduce((a, b) => a + b, 0), totalBytes: total});})));
  for (const path of ["/content/apple2p", "/content/a2diskiing", "/content/d2fdc"]) {core.FS.mkdirTree(path);}
  config.bios.forEach((file, i) => core.FS.writeFile(`/content/${peripheralDirectories[file.logicalName] ?? "apple2p"}/${file.logicalName}`, bytes[i + 1]));
  core.FS.writeFile("/content/game.dsk", bytes[0]);
  // This pilot exposes a single read-only disk. MAME retries its image open as
  // read-only when POSIX write permission is denied; no hidden disk save state.
  core.FS.chmod("/content/game.dsk", 0o444); core.FS.ignorePermissions = false;
  const command = 'apple2p -sl4 "" -sl6 diskiing -gameio joy -flop1 /content/game.dsk -rompath /content -skip_gameinfo -nothrottle';
  core.FS.writeFile("/content/boot.cmd", new TextEncoder().encode(command));
  const identity = ["apple2p", config.game.sha256, ...config.bios.map(file => `${file.logicalName}:${file.sha256}`).sort()].join("\n");
  return bytesToHex(sha256(new TextEncoder().encode(identity)));
}
