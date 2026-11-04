import {access, cp, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import { loadProviderSources, sha256 } from "./provider-sources.mjs";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildIsolatedBridges} from "./build-isolated-bridges.mjs";

const root = new URL("../", import.meta.url);
await buildIsolatedBridges(true);
await rejectRetiredCandidateDeclaration(root);
const sources = await loadProviderSources(root);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if ("version" in packageJson || "packageVersion" in sources) {throw new Error("PROVIDER_VERSION_MUST_COME_FROM_TAG");}
await Promise.all([
  access(new URL("dist/index.js", root)),
  access(new URL("dist/index.d.ts", root)),
  ...sources.localAssets.map(async (asset) => {
    const contents = await readFile(new URL(asset.source, root));
    if (!contents.length || sha256(contents).length !== 64) {throw new Error("LOCAL_ASSET_INVALID");}
  }),
]);
const declarations = await readFile(new URL("dist/index.d.ts", root), "utf8");
if (/\b(?:GameRuntime|RuntimeConfig|RpgRuntime|RpgGeneration|RpgPosition)\b|(?:create(?:Rpg|Ons|Kirikiri)|mount|describe)Runtime|runtimeAdapters|validateRuntimeConfig/u.test(declarations)) {
  throw new Error("LEGACY_PUBLIC_RUNTIME_API_PRESENT");
}
const packed = await packRuntime(fileURLToPath(root), packageJson);
console.log(`package-check: ok (${sources.upstreamReleases.length} upstream inputs; ${packed} package files)`);

/** The npm package ships the browser runtime only; server hosts embed the Go module at the same tag. */
async function packRuntime(repositoryRoot, metadata) {
  const temporary = await mkdtemp(join(tmpdir(), "retrom-package-check-"));
  try {
    const stage = join(temporary, "stage"); await mkdir(stage);
    for (const file of metadata.files) {await cp(join(repositoryRoot, file), join(stage, file), {recursive: true});}
    await writeFile(join(stage, "package.json"), JSON.stringify({...metadata, version: "0.0.0-dev"}));
    const {stdout} = await promisify(execFile)("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"],
      {cwd: stage, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
    const paths = JSON.parse(stdout)[0].files.map(file => file.path);
    for (const path of ["dist/index.js", "dist/index.d.ts", "dist/runtime/platforms.json", "README.md", "LICENSE"]) {
      if (!paths.includes(path)) {throw new Error(`RUNTIME_PACKAGE_FILE_MISSING:${path}`);}
    }
    if (paths.some(path => path.startsWith("scripts/") || path.endsWith(".go"))) {throw new Error("RUNTIME_PACKAGE_HOST_FILES_PRESENT");}
    return paths.length;
  } finally {await rm(temporary, {recursive: true, force: true});}
}

async function rejectRetiredCandidateDeclaration(base) {
  try {
    await access(new URL("candidate/runtime-candidate.json", base));
  } catch (error) {
    if (error?.code === "ENOENT") {return;}
    throw error;
  }
  throw new Error("PROVIDER_TARGET_DECLARATION_REQUIRED");
}
