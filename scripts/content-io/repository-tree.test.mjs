import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile, chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyResult} from "./evidence.mjs";
import {proofFixture} from "./proof-fixture.mjs";
for (const mutation of ["untracked", "mode", "outside-stage"]) {
  test(`[X-29] UNIT/repository-tree-${mutation} refuses changed repository bytes without a new HEAD`, async () => {
    const root = await mkdtemp(join(tmpdir(), "content-io-source-proof-"));
    try {
      const {stage, result, runRoot} = await proofFixture(root); await verifyResult(result, stage, root, runRoot);
      if (mutation === "mode") await chmod(join(root, "src/input.ts"), 0o755);
      else await writeFile(join(root, mutation + ".ts"), "changed source outside stage prefixes");
      await assert.rejects(() => verifyResult(result, stage, root, runRoot), /STALE/u);
    } finally {await rm(root, {recursive: true});}
  });
}

test("[X-29] UNIT/repository-tree-gitlink includes dirty submodule bytes and excludes ignored output", async () => {
  const {execFileSync} = await import("node:child_process");
  const {mkdir} = await import("node:fs/promises");
  const {repositoryTree} = await import("./repository-tree.mjs");
  const root = await mkdtemp(join(tmpdir(), "content-io-gitlink-"));
  try {
    await proofFixture(root);
    const child = join(root, "nested"); await mkdir(child); await proofFixture(child);
    const head = execFileSync("git", ["-C", child, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
    execFileSync("git", ["-C", root, "update-index", "--add", "--cacheinfo", `160000,${head},nested`]);
    const before = await repositoryTree(root);
    await writeFile(join(child, "ignored.log"), "new evidence"); assert.equal(await repositoryTree(root), before);
    await writeFile(join(child, "src/input.ts"), "dirty submodule bytes"); assert.notEqual(await repositoryTree(root), before);
  } finally {await rm(root, {recursive: true});}
});
