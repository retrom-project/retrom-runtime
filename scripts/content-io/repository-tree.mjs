import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readlink, realpath} from "node:fs/promises";
import {join} from "node:path";
import {within} from "./cli.mjs";
const git = (root, args) => execFileSync("git", ["-C", root, ...args], {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
const sha = value => createHash("sha256").update(value).digest("hex");
async function fileHash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
/** Independent proof fingerprint: actual files, executable bits, link text and recursively dirty gitlinks. */
export async function repositoryTree(root) {
  const tracked = new Map(git(root, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean).map(line => {
    const tab = line.indexOf("\t"), [mode, oid, stage] = line.slice(0, tab).split(" ");
    if (tab < 0 || stage !== "0") throw new Error("CONTENT_IO_UNMERGED_INPUT");
    return [line.slice(tab + 1), {mode, oid}];
  }));
  const paths = [...new Set(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))].sort();
  const entries = [];
  for (const path of paths) {
    const full = within(root, join(root, path));
    let stat;
    try {stat = await lstat(full);} catch (error) {if (error.code === "ENOENT") continue; throw error;}
    if (stat.isSymbolicLink()) {entries.push([path, "120000", sha(await readlink(full))]); continue;}
    within(root, await realpath(full));
    if (stat.isFile()) {entries.push([path, stat.mode & 0o111, await fileHash(full)]); continue;}
    if (!stat.isDirectory() || tracked.get(path)?.mode !== "160000") throw new Error("CONTENT_IO_INPUT_NOT_REGULAR");
    let nested = null;
    // An uninitialized submodule can resolve to the parent's Git root; it is not a populated checkout.
    if (git(full, ["rev-parse", "--show-toplevel"]).trim() === full) {
      nested = [git(full, ["rev-parse", "HEAD"]).trim(), await repositoryTree(full)];
    }
    entries.push([path, "160000", tracked.get(path).oid, nested]);
  }
  return sha(JSON.stringify(entries));
}
export function repositoryRoots(repositories) {
  return Object.fromEntries(Object.entries({runtime: repositories.runtime, retrom: repositories.retrom,
    ...Object.fromEntries(Object.entries(repositories.cores ?? {}).map(([id, value]) => [`core:${id}`, value]))})
    .filter(([, value]) => typeof value?.root === "string"));
}
export async function repositoryTrees(repositories) {
  const trees = {};
  for (const [id, repository] of Object.entries(repositoryRoots(repositories))) trees[id] = await repositoryTree(repository.root);
  return trees;
}
