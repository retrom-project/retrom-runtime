import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = join(root, "build", "dev-watch");
const target = join(root, "dist");
let building = false;
let queued = false;

async function build() {
  if (building) {queued = true; return;}
  building = true;
  try {
    await rm(buildRoot, { recursive: true, force: true });
    await mkdir(buildRoot, { recursive: true });
    await command("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", buildRoot]);
    const previous = `${target}.previous`;
    await rm(previous, { recursive: true, force: true });
    try {await rename(target, previous);} catch (error) {if (error?.code !== "ENOENT") {throw error;}}
    await rename(buildRoot, target);
    await rm(previous, { recursive: true, force: true });
    process.stdout.write("dev:watch rebuilt dist\n");
  } finally {
    building = false;
    if (queued) {queued = false; void build();}
  }
}

function command(executable, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error("DEV_WATCH_BUILD_FAILED")));
  });
}

async function directories(path) {
  const result = [path];
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.isDirectory()) {result.push(...await directories(join(path, item.name)));}
  }
  return result;
}

await build();
const watched = [join(root, "src"), join(root, "assets")];
for (const path of watched) {
  try {
    if (!(await stat(path)).isDirectory()) {continue;}
    for (const directory of await directories(path)) {watch(directory, { persistent: true }, () => void build());}
  } catch (error) {
    if (error?.code !== "ENOENT") {throw error;}
  }
}
for (const file of ["tsconfig.json", "tsconfig.build.json", "package.json"]) {
  watch(join(root, file), { persistent: true }, () => void build());
}
process.stdout.write("dev:watch ready\n");
