import {createHash} from "node:crypto";
import {lstat, readFile, readdir, writeFile, mkdir} from "node:fs/promises";
import {dirname, isAbsolute, join} from "node:path";

const sources = new Map([
  ["ardens", {repository: "https://github.com/retrom-project/Ardens",
    upstreamCommit: "661a7dd4febc8d00e790a4ecde44b936295adf97", license: "LICENSE"}],
  ["atari800", {repository: "https://github.com/retrom-project/libretro-atari800",
    upstreamCommit: "4e7fbc73765c1a9670c7506616046ad1d4ccda51", license: "LICENSE"}],
  ["freechaf", {repository: "https://github.com/retrom-project/FreeChaF",
    upstreamCommit: "76c7a84f1f7e80f3e6f2bba96fe100cb24e99124", license: "LICENSE"}],
  ["hatarib", {repository: "https://github.com/retrom-project/hatariB",
    upstreamCommit: "cceb40a9c054ad867c62834e1cd3a9547b207178", license: "LICENSE"}],
  ["sameduck", {repository: "https://github.com/retrom-project/SameBoy",
    upstreamCommit: "5619abdb01cee6bedb47599cdb5532c318443b52", license: "LICENSE"}],
  ["potator", {repository: "https://github.com/retrom-project/potator",
    upstreamCommit: "227c5f6f3ce74d32e9002ce24c1420288559a860", license: "LICENSE"}],
  ["supermodel", {repository: "https://github.com/retrom-project/Libretro-Supermodel",
    upstreamCommit: "84bc106b45b279bf868a53b9232897c8dc10ca17", license: "LICENSE", release: "4.3.0-pre"}],
  ["theodore", {repository: "https://github.com/retrom-project/theodore",
    upstreamCommit: "4d469ce0f71ee046ceb78cdbf8e9f18364aaa918", license: "LICENSE"}],
  ["gam4980", {repository: "https://github.com/retrom-project/gam4980",
    upstreamCommit: "eeaa531b55e7127ab4b5e0bdc5ceba686df59c6a", license: "LICENSE"}],
  ["uzem", {repository: "https://github.com/retrom-project/libretro-uzem",
    upstreamCommit: "d991ee94547c8294abc1c4cb73d63116aa58b5bc", license: "LICENSE"}],
  ["o2em", {repository: "https://github.com/retrom-project/libretro-o2em",
    upstreamCommit: "679d6fec04963f6e70a7ec217e3d0ebb1fe472fc", license: "LICENSE"}],
  ["gearboy", {repository: "https://github.com/retrom-project/Gearboy",
    upstreamCommit: "340ebe3c258846560cc93d93ca4359f506fafb70", license: "LICENSE"}],
  ["lutro", {repository: "https://github.com/retrom-project/libretro-lutro",
    upstreamCommit: "6224157a615b18507bc0b117a3398c7a324cd3e5", license: "LICENSE",
    adapterAbi: "emulatorjs-lutro-native-v1"}],
  ["vecx", {repository: "https://github.com/retrom-project/libretro-vecx",
    upstreamCommit: "8f671cc9d737f2890c3ce19e177e2984dcae121f", license: "LICENSE.md"}],

  ["quasi88", {repository: "https://github.com/retrom-project/quasi88-libretro",
    upstreamCommit: "459bbc6e90caa3dc392ae8e64a9b0881b1e5ef77", license: "LICENSE"}],
  ["bsnes", {repository: "https://github.com/retrom-project/bsnes-libretro",
    upstreamCommit: "4b344745e3878e7c0675a60c624582935524b8f7", license: "LICENSE.txt", release: "4.3.0-pre"}],

  ["neocd", {repository: "https://github.com/retrom-project/neocd_libretro",
    upstreamCommit: "3118c6901787e863e80e79170d02d47657b3b0ab", license: "LICENSE.md"}],
  ["same_cdi", {repository: "https://github.com/retrom-project/same_cdi",
    upstreamCommit: "cfb05d803f54130adf94efef88edd816d01df7a3", license: "COPYING"}],
  ...["vice_xpet", "vice_xplus4"].map((core) => [core, {repository: "https://github.com/retrom-project/vice-libretro",
    upstreamCommit: "1b4309f4d56ded7bfc5ad7ba8d5a9a44ac3388a8", license: "COPYING"}]),
  ["81", {repository: "https://github.com/retrom-project/81-libretro",
    upstreamCommit: "86decf3ee61ea5803972948e80197bee8474796b", license: "LICENSE"}],
  ["cap32", {repository: "https://github.com/retrom-project/libretro-cap32",
    upstreamCommit: "310cc579b79b6051b378b192224b325a73437c9b", license: "COPYING"}],
  ["crocods", {repository: "https://github.com/retrom-project/libretro-crocods",
    upstreamCommit: "be00fb904da08d66221017f6708508298f17ff07", license: "LICENSE"}],
]);
const names = (core) => [sources.get(core)?.license, `${core}-wasm.data`, "retrom-core-candidate.json", "source.tar.gz"].sort();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function developmentForkSource(id) {
  const source = sources.get(id);
  if (!source) {invalid();}
  return {id, repository: source.repository, upstreamCommit: source.upstreamCommit,
    adapterAbi: source.adapterAbi ?? "emulatorjs-state-v1"};
}

export function validEmulatorJsDevelopmentSource(value) {
  const source = sources.get(value?.id);
  return !!source && exact(value, ["id", "repository", "upstreamCommit", "adapterAbi"]) &&
    value.repository === source.repository && value.upstreamCommit === source.upstreamCommit &&
    value.adapterAbi === (source.adapterAbi ?? "emulatorjs-state-v1");
}

export function developmentForkFiles(catalog) {
  const forks = catalog.developmentForks ?? [];
  if (!Array.isArray(forks) || forks.length > sources.size || new Set(forks.map((fork) => fork?.runtimeCore)).size !== forks.length) {invalid();}
  return forks.flatMap((fork) => {
    if (!exact(fork, ["runtimeCore", "repository", "upstreamCommit", "commit", "sourceTreeSha256", "adapterAbi", "assets"]) ||
      !validEmulatorJsDevelopmentSource({id: fork.runtimeCore, repository: fork.repository,
        upstreamCommit: fork.upstreamCommit, adapterAbi: fork.adapterAbi}) ||
      !/^[0-9a-f]{40}$/u.test(fork.commit) || !digest(fork.sourceTreeSha256) || !Array.isArray(fork.assets) ||
      fork.assets.map((file) => file.filename).sort().join("\0") !== names(fork.runtimeCore).join("\0")) {invalid();}
    return fork.assets.map((file) => {
      if (!exact(file, ["filename", "sha256", "sizeBytes"]) || !digest(file.sha256) ||
      !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 ||
      file.sizeBytes > (file.filename === "source.tar.gz" ? 64 : 16) * 1024 * 1024) {invalid();}
      const release = sources.get(fork.runtimeCore).release ?? "4.2.3";
      const destination = file.filename === `${fork.runtimeCore}-wasm.data` ? `${release}/data/cores/${file.filename}`
        : file.filename === "retrom-core-candidate.json" ? `${release}/data/cores/reports/${fork.runtimeCore}.json`
          : `${release}/licenses/forks/${fork.runtimeCore}/${file.filename}`;
      return {...file, destination, runtimeCore: fork.runtimeCore};
    });
  });
}

export function requireDevelopmentForkMode(catalog, allowed) {
  if (developmentForkFiles(catalog).length && !allowed) {throw new Error("UNPUBLISHED_CORE_INPUT");}
}

export function verifyDevelopmentForkMetadata(fork, metadata) {
  if (!exact(metadata, ["schemaVersion", "kind", "coreId", "repository", "branch", "commit", "dirty",
    "sourceTreeSha256", "adapterAbi", "files"]) || metadata.schemaVersion !== 1 ||
    metadata.kind !== "RETROM_CORE_CANDIDATE_V1" || metadata.coreId !== fork.runtimeCore ||
    metadata.repository !== fork.repository || metadata.adapterAbi !== fork.adapterAbi ||
    metadata.commit !== fork.commit || metadata.sourceTreeSha256 !== fork.sourceTreeSha256 ||
    typeof metadata.dirty !== "boolean" || !/^(?:feat|fix|build)\/[a-z0-9-]+$/u.test(metadata.branch) ||
    !Array.isArray(metadata.files) || metadata.files.length !== 3) {invalid();}
  for (const asset of fork.assets.filter((file) => file.filename !== "retrom-core-candidate.json")) {
    const file = metadata.files.find((entry) => entry.filename === asset.filename);
    if (!exact(file, ["filename", "sha256", "sizeBytes"]) || file.sha256 !== asset.sha256 ||
      file.sizeBytes !== asset.sizeBytes) {invalid();}
  }
}

export async function stageDevelopmentForks(catalog, roots, destinationRoot) {
  const files = developmentForkFiles(catalog);
  for (const fork of catalog.developmentForks ?? []) {
    const directory = roots?.get(fork.runtimeCore);
    if (typeof directory !== "string" || !isAbsolute(directory)) {invalid();}
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
      (await readdir(directory)).sort().join("\0") !== names(fork.runtimeCore).join("\0")) {invalid();}
    for (const file of files.filter((entry) => entry.runtimeCore === fork.runtimeCore)) {
      const source = join(directory, file.filename);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes) {invalid();}
      const bytes = await readFile(source);
      if (hash(bytes) !== file.sha256) {invalid();}
      if (file.filename === "retrom-core-candidate.json") {
        verifyDevelopmentForkMetadata(fork, JSON.parse(bytes.toString("utf8")));
      }
      const output = join(destinationRoot, file.destination);
      await mkdir(dirname(output), {recursive: true});
      await writeFile(output, bytes);
    }
  }
}
function invalid() {throw new Error("EMULATORJS_DEVELOPMENT_FORK_INVALID");}
