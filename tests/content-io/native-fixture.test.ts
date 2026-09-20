// @vitest-environment node
import {expect, it} from "vitest";
import {nativeInputs, verifyNativeReceipt} from "./native-fixture.js";
const inputs = Object.fromEntries(nativeInputs.map(name => [name, {sizeBytes: 10, sha256: "a".repeat(64)}]));
const outputs = {"content-native.js": {sizeBytes: 20, sha256: "b".repeat(64)}, "content-native.wasm": {sizeBytes: 30, sha256: "c".repeat(64)}};
const receipt = () => ({schemaVersion: 1, kind: "MKXP_CONTENT_IO_NATIVE_FIXTURE", compiler: "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 4.0.8 (70404efec4458b60b953bc8f1529f2fa112cdfd1)", inputs, outputs});
it("[X-29] UNIT/native-fixture-proof rejects a stale native artifact, modified C++ and wrong compiler before browser execution", () => {
  expect(() => verifyNativeReceipt(receipt(), inputs, outputs)).not.toThrow();
  expect(() => verifyNativeReceipt({...receipt(), compiler: "emcc 3.1.46"}, inputs, outputs)).toThrow("COMPILER_INVALID");
  expect(() => verifyNativeReceipt({...receipt(), outputs: {...outputs, "content-native.wasm": {...outputs["content-native.wasm"], sha256: "d".repeat(64)}}}, inputs, outputs)).toThrow("OUTPUT_CHANGED");
  expect(() => verifyNativeReceipt(receipt(), {...inputs, [nativeInputs[0]]: {sizeBytes: 10, sha256: "e".repeat(64)}}, outputs)).toThrow("SOURCE_CHANGED");
  expect(() => verifyNativeReceipt({...receipt(), extra: "ignored"}, inputs, outputs)).toThrow("RECEIPT_INVALID");
});
