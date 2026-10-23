// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {configureHostInput} from "../scripts/runtime-host-input.mjs";
import {configureRuntime} from "../src/runtime/configure.js";
import {prepareRuntime} from "../src/runtime/prepare.js";
import type {RuntimeContentFile} from "../src/runtime/types.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const file = (logicalKey: string): RuntimeContentFile => ({logicalKey, name: logicalKey, sizeBytes: 128, sha256: "a".repeat(64)});
const request = {platformId: "kirikiri", coreIds: ["kirikiri2"]};

it("identifies an XP3 archive under a different suffix from bounded package-member evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-xp3-")); roots.push(root);
  const prefix = Buffer.from("5850330d0a200a1a8b6701", "hex"), content = Buffer.concat([prefix, Buffer.alloc(2000)]);
  const physical = join(root, "package"); await writeFile(physical, Buffer.concat([Buffer.from("before"), content, Buffer.from("after")]));
  const main = {...file("game/data.bin"), sizeBytes: content.length, sha256: createHash("sha256").update(content).digest("hex")};
  const files = [main, file("game/patch.xp3"), file("game/graphics.xp3")];
  const input = await configureHostInput({...request, files, locators: {
    [main.logicalKey]: {path: physical, offset: 6, sizeBytes: main.sizeBytes},
  }});
  const config = configureRuntime(input);
  expect(config.content).toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/data.bin"});
  const prepared = prepareRuntime({config, files, fingerprints: {"retrom-runtime/kirikiri2-kag": "b".repeat(64)},
    directory: {platformId: "kirikiri", defaultCoreId: "kirikiri2", allowedCoreIds: ["kirikiri2"]}});
  expect(prepared.targetOptions.startupXp3Path).toBe("data.bin");
  expect(prepared.resources[0].entryFile).toBe("data.bin");
});

it("selects a canonical project root containing a nested backup of the same canonical entry", () => {
  expect(configureRuntime({...request, files: [file("game/data.xp3"), file("game/Backup/data.xp3")]}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/data.xp3"});
});

it("retains ambiguity between peer projects and validates an explicit entry against engine candidates", () => {
  const input = {...request, files: [file("one/data.xp3"), file("two/data.xp3"), file("readme.txt")]};
  expect(() => configureRuntime(input)).toThrow("RUNTIME_ENTRY_REQUIRED");
  expect(configureRuntime({...input, selection: {entryFile: "two/data.xp3"}}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "two/data.xp3"});
  expect(() => configureRuntime({...input, selection: {entryFile: "readme.txt"}})).toThrow("RUNTIME_ENTRY_MISSING");
});
