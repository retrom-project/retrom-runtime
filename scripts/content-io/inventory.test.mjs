import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scanRepository} from "./inventory.mjs";

test("[S00] inventory reflects new and removed PFB working files", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-inventory-"));
  try {
    execFileSync("git", ["init", "--quiet", root]); await mkdir(join(root, "src"));
    await writeFile(join(root, "src/old.ts"), 'fetch("old");');
    execFileSync("git", ["-C", root, "add", "."]); await rm(join(root, "src/old.ts"));
    await writeFile(join(root, "src/new.ts"), 'fetch("new");');
    assert.deepEqual((await scanRepository(root, ["src"])).map(file => file.path), ["src/new.ts"]);
  } finally {await rm(root, {recursive: true});}
});
