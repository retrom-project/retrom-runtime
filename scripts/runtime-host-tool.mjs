import {cp, mkdir, mkdtemp, readFile, writeFile, access, rename, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {dirname, join} from "node:path";
import {versionFromTag} from "./release-version.mjs";

const execute = promisify(execFile);

/** Ship the complete npm layout and production dependency closure as one offline host artifact. */
export async function buildRuntimeHostTool({repositoryRoot, outputRoot, version, sourceTreeSha256}) {
  if (!validBuildVersion(version) ||
    !/^[a-f0-9]{64}$/u.test(sourceTreeSha256)) {throw new Error("RUNTIME_HOST_TOOL_IDENTITY_INVALID");}
  const metadata = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const name = `retrom-runtime-host-tool-${version}`;
  await mkdir(outputRoot, {recursive: true});
  const temporary = await mkdtemp(join(outputRoot, ".host-tool-")), toolRoot = join(temporary, name);
  try {
  await mkdir(toolRoot);
  for (const path of metadata.files) {await cp(join(repositoryRoot, path), join(toolRoot, path), {recursive: true});}
  await writeFile(join(toolRoot, "package.json"), JSON.stringify({...metadata, version}));
  await writeFile(join(toolRoot, "host-tool.json"), JSON.stringify({schemaVersion: 1, version, sourceTreeSha256}));
  await copyProductionDependencies(repositoryRoot, join(toolRoot, "node_modules"), metadata.dependencies);
  const archivePath = join(outputRoot, `${name}.tar.gz`), pendingArchive = join(temporary, `${name}.tar.gz`);
  await execute("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "-czf", pendingArchive, "-C", temporary, name], {timeout: 30000});
  const archive = await readFile(pendingArchive);
  await rename(pendingArchive, archivePath);
  return {archivePath, sizeBytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex")};
  } finally {await rm(temporary, {recursive: true, force: true});}
}

function validBuildVersion(version) {
  if (version === "0.0.0-dev" || /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-dev\.[1-9][0-9]*$/u.test(version)) {return true;}
  try {versionFromTag(`v${version}`); return true;} catch {return false;}
}

export async function copyProductionDependencies(sourceRoot, destination, dependencies, copied = new Map()) {
  const require = createRequire(join(sourceRoot, "package.json"));
  for (const id of Object.keys(dependencies ?? {})) {
    let source;
    for (const base of require.resolve.paths(id) ?? []) {
      const candidate = join(base, id, "package.json");
      try {await access(candidate); source = dirname(candidate); break;} catch {continue;}
    }
    if (!source) {throw new Error(`RUNTIME_PACKAGE_DEPENDENCY_MISSING:${id}`);}
    const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (copied.has(id)) {if (copied.get(id) !== metadata.version) {throw new Error(`RUNTIME_PACKAGE_DEPENDENCY_CONFLICT:${id}`);} continue;}
    copied.set(id, metadata.version); await mkdir(dirname(join(destination, id)), {recursive: true});
    await cp(source, join(destination, id), {recursive: true});
    await copyProductionDependencies(source, destination, metadata.dependencies, copied);
  }
}
