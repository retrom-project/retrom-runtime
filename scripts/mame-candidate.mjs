import {stageCoreDevelopmentInput} from "./core-development-input.mjs";
import {lstat, readFile} from "node:fs/promises";
import {join} from "node:path";

export async function stageMameCandidate(release, directory, stage) {
  if (release.id !== "mame" || release.repository !== "https://github.com/retrom-project/mame" ||
    release.adapterAbi !== "retrom-mame-dylink-v1") {invalid();}
  const path = join(directory, "mame-build.json"), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 2097152) {invalid();}
  const metadata = JSON.parse(await readFile(path, "utf8"));
  if (metadata.schemaVersion !== 1 || metadata.adapterAbi !== release.adapterAbi ||
    !metadata.families || Array.isArray(metadata.families) || typeof metadata.families !== "object") {invalid();}
  const families = Object.entries(metadata.families);
  if (!families.length || families.length > 128 || families.some(([name, family]) =>
    !/^[a-z0-9_]+$/u.test(name) || family?.module !== `mame-${name}.wasm` ||
    typeof family.arcade !== "boolean" || !Array.isArray(family.machines) ||
    !family.machines.length || family.machines.some(machine => typeof machine !== "string" || !/^[a-z0-9_]+$/u.test(machine)))) {invalid();}
  const filenames = ["LICENSES.txt", "mame-arcade.xml", "mame-build.json", "mame-common.mjs", "mame-common.wasm",
    ...families.map(([, family]) => family.module)].sort();
  const source = {id: release.id, repository: release.repository, upstreamCommit: release.upstreamCommit,
    adapterAbi: release.adapterAbi, assets: filenames.map(filename => ({filename,
      output: filename === "LICENSES.txt" ? "licenses/mame/LICENSES.txt" : `runtime/mame/${filename}`,
      maxSizeBytes: filename.endsWith(".wasm") ? 134217728 : filename === "mame-arcade.xml" ? 67108864 :
        filename.endsWith(".mjs") ? 4194304 : 2097152}))};
  return stageCoreDevelopmentInput(source, directory, stage);
}
function invalid() {throw new Error("CORE_CANDIDATE_INVALID");}
