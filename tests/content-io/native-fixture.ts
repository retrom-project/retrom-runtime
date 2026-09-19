import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, lstat, realpath} from "node:fs/promises";
import {join, relative, isAbsolute, resolve} from "node:path";
import {coreFixturePath} from "./core-fixture.js";
const recipe = ".github/rpg-runtime/content-io/";
export const nativeInputs = ["test-native.cpp", "retrom-content-bridge.cpp", "retrom-content-manifest.cpp",
  "retrom-content-bridge.h", "build-native-test.sh", "native-test-receipt.py"].map(name => recipe + name).concat([
  ".github/rpg-runtime/patch-remote-content.py", "retroarch/Makefile.emscripten", "retroarch/frontend/drivers/platform_emscripten.c"]);
type Fingerprint = {sizeBytes: number; sha256: string};
const fingerprint = (bytes: Uint8Array): Fingerprint => ({sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
export function verifyNativeReceipt(receipt: unknown, inputs: Record<string, Fingerprint>, outputs: Record<string, Fingerprint>) {
  assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt), "NATIVE_FIXTURE_RECEIPT_INVALID");
  assert.deepEqual(Object.keys(receipt).sort(), ["compiler", "inputs", "kind", "outputs", "schemaVersion"], "NATIVE_FIXTURE_RECEIPT_INVALID");
  assert.ok("schemaVersion" in receipt && receipt.schemaVersion === 1 && "kind" in receipt && receipt.kind === "MKXP_CONTENT_IO_NATIVE_FIXTURE", "NATIVE_FIXTURE_RECEIPT_INVALID");
  assert.ok("compiler" in receipt && typeof receipt.compiler === "string" && receipt.compiler === "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 4.0.8 (70404efec4458b60b953bc8f1529f2fa112cdfd1)", "NATIVE_FIXTURE_COMPILER_INVALID");
  assert.ok("inputs" in receipt && "outputs" in receipt, "NATIVE_FIXTURE_RECEIPT_INVALID");
  assert.deepEqual(Object.keys(inputs).sort(), [...nativeInputs].sort(), "NATIVE_FIXTURE_INPUT_SET_INVALID");
  assert.deepEqual(Object.keys(outputs).sort(), ["content-native.js", "content-native.wasm"], "NATIVE_FIXTURE_OUTPUT_SET_INVALID");
  assert.deepEqual(receipt.inputs, inputs, "NATIVE_FIXTURE_SOURCE_CHANGED");
  assert.deepEqual(receipt.outputs, outputs, "NATIVE_FIXTURE_OUTPUT_CHANGED");
}
export async function nativeFixture(root: string) {
  const environmentPath = process.env.RETROM_CONTENT_IO_ENV;
  assert.ok(environmentPath, "CONTENT_IO_ENV_REQUIRED");
  const environment = JSON.parse(await readFile(environmentPath, "utf8")) as {paths: {evidenceRoot: string}};
  const local = relative(environment.paths.evidenceRoot, root);
  assert.ok(isAbsolute(root) && root === resolve(root) && !isAbsolute(local) && local !== ".." && !local.startsWith("../") && await realpath(root) === root, "NATIVE_FIXTURE_PATH_INVALID");
  const bytes = async (name: string) => {
    const path = join(root, name), stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "NATIVE_FIXTURE_PATH_INVALID"); return readFile(path);
  };
  const descriptor: unknown = JSON.parse((await bytes("native-fixture.json")).toString("utf8"));
  const inputs: Record<string, Fingerprint> = {};
  for (const name of nativeInputs) {inputs[name] = fingerprint(await readFile(await coreFixturePath("mkxp", name)));}
  const js = await bytes("content-native.js"), wasm = await bytes("content-native.wasm");
  verifyNativeReceipt(descriptor, inputs, {"content-native.js": fingerprint(js), "content-native.wasm": fingerprint(wasm)});
  return {js: js.toString("utf8"), wasm: new Uint8Array(wasm), descriptor};
}
