import {readFile, readdir, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {watch} from "node:fs";

import {buildPFBProviderDev, defaultPFBProviderDevInput} from "./pfb-provider-dev.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = ["PFB_PROVIDER_ACTIVE_PATH", "PFB_PROVIDER_INSTALLED_ROOT", "PFB_PROVIDER_DEV_ROOT"];
for (const name of required) {
  if (!process.env[name] || !resolve(process.env[name]).startsWith("/")) {
    throw new Error(`PFB_PROVIDER_DEV_INPUT_INVALID:${name}`);
  }
}
const sources = JSON.parse(await readFile(join(root, "provider-sources.json"), "utf8"));
const input = {
  ...defaultPFBProviderDevInput,
  activePath: resolve(process.env.PFB_PROVIDER_ACTIVE_PATH),
  installedRoot: resolve(process.env.PFB_PROVIDER_INSTALLED_ROOT),
  outputRoot: resolve(process.env.PFB_PROVIDER_DEV_ROOT),
  localAssets: sources.localAssets.map((asset) => ({
    source: join(root, asset.source), output: asset.output,
  })),
};
let building = false;
let queued = false;
let lastError;

async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  try {
    const result = await buildPFBProviderDev(input);
    lastError = undefined;
    process.stdout.write(`pfb provider dev module ${result.moduleSha256}\n`);
  } catch (error) {
    lastError = error;
    process.stderr.write(`${error?.stack ?? error}\n`);
  } finally {
    building = false;
    if (queued) { queued = false; void rebuild(); }
  }
}

async function directories(path) {
  const result = [path];
  for (const item of await readdir(path, {withFileTypes: true})) {
    if (item.isDirectory()) { result.push(...await directories(join(path, item.name))); }
  }
  return result;
}

await rebuild();
if (process.argv.includes("--once")) {
  if (lastError) { throw lastError; }
  process.stdout.write("pfb provider dev build complete\n");
  process.exit(0);
}
for (const path of [join(root, "src"), join(root, "assets")]) {
  if (!(await stat(path)).isDirectory()) { continue; }
  for (const directory of await directories(path)) {
    watch(directory, {persistent: true}, () => void rebuild());
  }
}
for (const file of ["package.json", "provider-sources.json", "tsconfig.json"]) {
  watch(join(root, file), {persistent: true}, () => void rebuild());
}
process.stdout.write("pfb provider dev watcher ready\n");
