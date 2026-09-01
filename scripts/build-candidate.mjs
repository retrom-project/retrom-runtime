import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exactKeys, loadCandidateDeclaration } from "./candidate-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
await emptyAbsoluteDirectory(args.output);
const spec = JSON.parse(await readFile(args.spec, "utf8"));
if (!exactKeys(spec, ["schemaVersion", "name", "id", "hostMode", "retrom", "runtime", "cores"]) ||
  spec?.schemaVersion !== 1 || spec.hostMode !== "LOCALHOST_SHARED_GATEWAY_V1" ||
  !exactKeys(spec.runtime, ["mode", "root", "branch"]) || spec.runtime?.mode !== "branch" ||
  await realpath(spec.runtime.root) !== await realpath(root) || !Array.isArray(spec.cores)) {
  throw new Error("PFB_SPEC_INVALID");
}
const coreRoot = resolve(args.output, "..", "cores");
const declaration = await loadCandidateDeclaration(root);
const overrides = {};
const branchInputs = new Map();
for (const core of spec.cores) {
  if (!exactKeys(core, ["id", "mode", "root", "branch"]) || core.mode !== "branch" ||
    !/^[a-z0-9_]{1,64}$/u.test(core.id)) {throw new Error("PFB_SPEC_INVALID");}
  const directory = join(coreRoot, core.id);
  const descriptorPath = join(directory, "retrom-core-candidate.json");
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  await validateCoreDescriptor(descriptor, core, directory);
  if (!declaration || core.id !== declaration.branchCoreId) {overrides[core.id] = directory;}
  branchInputs.set(core.id, {
    id: core.id, mode: "branch", repository: descriptor.repository,
    branch: descriptor.branch, commit: descriptor.commit, dirty: descriptor.dirty,
    sourceTreeSha256: descriptor.sourceTreeSha256, adapterAbi: descriptor.adapterAbi,
    descriptorSha256: sha(await readFile(descriptorPath)), files: descriptor.files,
  });
}
const formalRuntimeManifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8"));
const formalReleaseIds = new Set(formalRuntimeManifest.upstreamReleases.map((release) => release.id));
if (declaration && (formalReleaseIds.has(declaration.branchCoreId) || !branchInputs.has(declaration.branchCoreId))) {
  throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${declaration.branchCoreId}`);
}
const coreInputs = formalRuntimeManifest.upstreamReleases.map((release) => branchInputs.get(release.id) ?? ({
  id: release.id, mode: "formal", repository: release.repository, tag: release.tag,
  commit: release.commit, adapterAbi: release.adapterAbi,
  assets: release.assets.map((asset) => ({ filename: asset.filename, output: asset.output })),
}));
for (const identifier of branchInputs.keys()) {
  if (!formalReleaseIds.has(identifier) && (!declaration || declaration.branchCoreId !== identifier)) {
    throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${identifier}`);
  }
}
if (declaration) {coreInputs.push(branchInputs.get(declaration.branchCoreId));}
run("npm", ["run", "build"]);
const candidateEnvironment = {
  RETROM_PFB_CANDIDATE_BUILD: "1",
  RETROM_RUNTIME_DEV_RELEASE_OVERRIDES: JSON.stringify(overrides),
};
run("node", ["scripts/build-release.mjs"], candidateEnvironment);
run("npm", ["run", "package:check"], { RETROM_PFB_CANDIDATE_BUILD: "1" });
if (declaration) {await publishNewCoreFiles(declaration, branchInputs.get(declaration.branchCoreId));}
await cp(join(root, "release", "stage"), join(args.output, "stage"), { recursive: true });
const packageFile = `xxxsen-retrom-runtime-${JSON.parse(await readFile(join(root, "package.json"), "utf8")).version}.tgz`;
await mkdir(join(args.output, "package"));
await cp(join(root, "release", packageFile), join(args.output, "package", packageFile));
const identity = gitIdentity();
const files = await collectFiles(args.output);
const descriptor = {
  schemaVersion: 1,
  kind: "RETROM_RUNTIME_CANDIDATE_V1",
  repository: "https://github.com/retrom-project/retrom-runtime",
  ...identity,
  packageName: "@xxxsen/retrom-runtime",
  publicApiVersion: 2,
  coreInputs: coreInputs.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id))),
  files,
};
await writeCanonical(join(args.output, "retrom-runtime-candidate.json"), descriptor);
const formalManifest = await readFile(join(args.spec, "..", "..", "data", "dat", "rpgmaker", "v1", "manifest.json"));
const overlayWithoutDigest = {
  schemaVersion: 1,
  kind: "RETROM_PFB_CANDIDATE_V1",
  pfbId: spec.id,
  formalManifestSha256: sha(formalManifest),
  runtime: identity,
  cores: coreInputs,
  runtimeFiles: declaration ? declaration.runtimeFiles.map((file) => ({
    bundle_path: file.bundlePath, path_in_release: file.pathInRelease,
    role: file.role, max_size_bytes: file.maxSizeBytes,
  })) : [],
  artifacts: declaration ? [{
    ...declaration.artifact,
    runtime_version: `v${formalRuntimeManifest.packageVersion}`,
  }] : [],
  filesSha256: sha(canonical(files)),
};
await writeCanonical(join(args.output, ".retrom-pfb-candidate.json"), {
  ...overlayWithoutDigest,
  overlaySha256: sha(canonical(overlayWithoutDigest)),
});

function parseArgs(values) {
  if (values.length !== 4 || values[0] !== "--spec" || values[2] !== "--output") {throw new Error("PFB_SPEC_INVALID");}
  const spec = resolve(values[1]);
  const output = resolve(values[3]);
  if (spec !== values[1] || output !== values[3]) {throw new Error("PFB_SPEC_INVALID");}
  return { spec, output };
}

async function emptyAbsoluteDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(path)).length !== 0) {throw new Error("PFB_CANDIDATE_OUTPUT_INVALID");}
}

function run(executable, commandArgs, extraEnvironment = {}) {
  const result = spawnSync(executable, commandArgs, { cwd: root, env: { ...process.env, ...extraEnvironment }, stdio: "inherit" });
  if (result.status !== 0) {throw new Error("PFB_CANDIDATE_OUTPUT_INVALID");}
}

async function validateCoreDescriptor(descriptor, core, directory) {
  if (!exactKeys(descriptor, [
    "schemaVersion", "kind", "coreId", "repository", "branch", "commit", "dirty",
    "sourceTreeSha256", "adapterAbi", "files",
  ]) || descriptor.schemaVersion !== 1 || descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" ||
    descriptor.coreId !== core.id || descriptor.branch !== core.branch ||
    !/^https:\/\/github\.com\/retrom-project\/[A-Za-z0-9._-]+$/u.test(descriptor.repository) ||
    !/^[0-9a-f]{40}$/u.test(descriptor.commit) || typeof descriptor.dirty !== "boolean" ||
    !/^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) ||
    typeof descriptor.adapterAbi !== "string" || !Array.isArray(descriptor.files) || !descriptor.files.length) {
    throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${core.id}`);
  }
  const names = [];
  for (const file of descriptor.files) {
    if (!exactKeys(file, ["filename", "sizeBytes", "sha256"]) || basename(file.filename) !== file.filename ||
      !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
      throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${core.id}`);
    }
    const target = join(directory, file.filename);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes ||
      sha(await readFile(target)) !== file.sha256) {
      throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${core.id}`);
    }
    names.push(file.filename);
  }
  const expected = [...names].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const actual = (await readdir(directory)).filter((name) => name !== "retrom-core-candidate.json")
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (new Set(names).size !== names.length || JSON.stringify(names) !== JSON.stringify(expected) ||
    JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${core.id}`);
  }
}

async function publishNewCoreFiles(declaration, input) {
  const descriptorFiles = new Map(input.files.map((file) => [file.filename, file]));
  const candidateDirectory = join(coreRoot, declaration.branchCoreId);
  for (const file of declaration.runtimeFiles) {
    const record = descriptorFiles.get(file.candidateFilename);
    if (!record || record.sizeBytes > file.maxSizeBytes) {
      throw new Error(`PFB_CANDIDATE_OUTPUT_INVALID:${declaration.branchCoreId}`);
    }
    const target = join(root, "release", "stage", file.bundlePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(candidateDirectory, file.candidateFilename), target);
  }
}

function gitIdentity() {
  const value = (commandArgs) => {
    const result = spawnSync("git", commandArgs, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) {throw new Error("PFB_WORKTREE_INVALID");}
    return result.stdout.trim();
  };
  return {
    branch: value(["symbolic-ref", "--quiet", "--short", "HEAD"]),
    commit: value(["rev-parse", "HEAD"]),
    dirty: Boolean(value(["status", "--porcelain=v1"])),
    sourceTreeSha256: sourceTree(),
  };
}

function sourceTree() {
  const raw = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).stdout;
  const rawModes = spawnSync("git", ["ls-files", "--stage", "-z"], { cwd: root }).stdout;
  const modes = new Map(rawModes.toString("utf8").split("\0").filter(Boolean).map((item) => {
    const [prefix, path] = item.split("\t");
    return [path, prefix.split(" ", 1)[0]];
  }));
  const entries = [];
  for (const path of raw.toString("utf8").split("\0").filter(Boolean).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
    const info = lstatSync(join(root, path));
    const mode = info.isSymbolicLink() ? "120000" : (modes.get(path) ?? ((info.mode & 0o100) ? "100755" : "100644"));
    const contents = mode === "120000" ? Buffer.from(readlinkSync(join(root, path))) : readFileSync(join(root, path));
    entries.push({ path, mode, sha256: sha(contents) });
  }
  return sha(canonical(entries));
}

async function collectFiles(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {await visit(path); continue;}
      if (!entry.isFile()) {throw new Error("PFB_CANDIDATE_OUTPUT_INVALID");}
      const contents = await readFile(path);
      result.push({ path: path.slice(directory.length + 1).replaceAll("\\", "/"), filename: basename(path), sizeBytes: contents.length, sha256: sha(contents) });
    }
  }
  await visit(directory);
  return result.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
}

function canonical(value) {return Buffer.from(JSON.stringify(sortValue(value)));}
function sortValue(value) {
  if (Array.isArray(value)) {return value.map(sortValue);}
  if (value && typeof value === "object") {return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));}
  return value;
}
function sha(contents) {return createHash("sha256").update(contents).digest("hex");}
async function writeCanonical(path, value) {await writeFile(path, Buffer.concat([canonical(value), Buffer.from("\n")]));}
