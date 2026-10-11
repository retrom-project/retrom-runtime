// @vitest-environment node
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {afterEach, expect, it} from "vitest";
import {stageMameCandidate} from "../scripts/mame-candidate.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function fixture(commonJsSize = 0) {
  const root = await mkdtemp(join(tmpdir(), "mame-candidate-")); roots.push(root);
  const directory = join(root, "core"), stage = pathToFileURL(join(root, "stage") + "/");
  await mkdir(directory);
  const modules = Object.fromEntries(["mame-common.mjs", "mame-common.wasm", "mame-arcade_existing.wasm", "mame-arcade_new.wasm"]
    .map(filename => [filename, new TextEncoder().encode(filename)]));
  if (commonJsSize) {modules["mame-common.mjs"] = new Uint8Array(commonJsSize).fill(32);}
  const metadata = {schemaVersion: 1, adapterAbi: "retrom-mame-dylink-v1", buildId: "a".repeat(64),
    assets: Object.fromEntries(Object.entries(modules).map(([filename, bytes]) => [filename, {sizeBytes: bytes.length, sha256: sha(bytes)}])),
    families: {arcade_existing: {module: "mame-arcade_existing.wasm", arcade: true, machines: ["existing"]},
      arcade_new: {module: "mame-arcade_new.wasm", arcade: true, machines: ["new"]}}};
  const payloads: Record<string, Uint8Array> = {...modules, "mame-build.json": new TextEncoder().encode(JSON.stringify(metadata)),
    "mame-arcade.xml": new TextEncoder().encode('<mame><machine name="new"/></mame>'), "LICENSES.txt": new TextEncoder().encode("test license")};
  const release = {id: "mame", repository: "https://github.com/retrom-project/mame", upstreamCommit: "b".repeat(40),
    adapterAbi: "retrom-mame-dylink-v1", assets: Object.keys(payloads).filter(filename => filename !== "mame-arcade_new.wasm")
      .map(filename => ({filename, output: filename === "LICENSES.txt" ? "licenses/mame/LICENSES.txt" : `runtime/mame/${filename}`, maxSizeBytes: 134217728}))};
  const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "mame", repository: release.repository,
    branch: "feat/test", commit: "c".repeat(40), dirty: false, sourceTreeSha256: "d".repeat(64), adapterAbi: release.adapterAbi,
    files: Object.entries(payloads).map(([filename, bytes]) => ({filename, sizeBytes: bytes.length, sha256: sha(bytes)}))};
  for (const [filename, bytes] of Object.entries(payloads)) {await writeFile(join(directory, filename), bytes);}
  await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify(descriptor));
  return {directory, stage, release, payloads, metadata};
}

it("includes every verified candidate family without changing the formal release asset inventory", async () => {
  const sample = await fixture(), before = structuredClone(sample.release);
  const paths = await stageMameCandidate(sample.release, sample.directory, sample.stage);
  expect(paths).toContain("runtime/mame/mame-arcade_new.wasm");
  expect(await readFile(new URL("runtime/mame/mame-arcade_new.wasm", sample.stage)))
    .toEqual(Buffer.from(sample.payloads["mame-arcade_new.wasm"]));
  expect(sample.release).toEqual(before);
});

it("rejects candidate bytes that no longer match their declared digest", async () => {
  const sample = await fixture();
  await writeFile(join(sample.directory, "mame-arcade_new.wasm"), "tampered");
  await expect(stageMameCandidate(sample.release, sample.directory, sample.stage)).rejects.toThrow("CORE_CANDIDATE_INVALID");
});

it("stages the enlarged verified Current loader while retaining an upper bound", async () => {
  const sample = await fixture(2 * 1024 * 1024 + 65536);
  await expect(stageMameCandidate(sample.release, sample.directory, sample.stage)).resolves.toContain("runtime/mame/mame-common.mjs");
  const oversized = await fixture(4 * 1024 * 1024 + 1);
  await expect(stageMameCandidate(oversized.release, oversized.directory, oversized.stage)).rejects.toThrow("CORE_CANDIDATE_INVALID");
});

it("rejects a family module outside the MAME asset namespace", async () => {
  const sample = await fixture();
  sample.metadata.families.arcade_new.module = "../outside.wasm";
  const bytes = new TextEncoder().encode(JSON.stringify(sample.metadata));
  await writeFile(join(sample.directory, "mame-build.json"), bytes);
  const descriptorPath = join(sample.directory, "retrom-core-candidate.json");
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  Object.assign(descriptor.files.find((file: {filename: string}) => file.filename === "mame-build.json"),
    {sizeBytes: bytes.length, sha256: sha(bytes)});
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  await expect(stageMameCandidate(sample.release, sample.directory, sample.stage)).rejects.toThrow("CORE_CANDIDATE_INVALID");
});
