// @vitest-environment node
import {expect, it} from "vitest";
import {probeXmoeCompanion} from "../scripts/normalization/xmoe-pe.mjs";
import {companion} from "./normalization-xmoe-fixture.js";

it.each([{salt: 0}, {salt: 73, imageBase: 0x67000000, subtract: 0x387412ac}])("discovers parameters through related native code with generated PE constants: %j", options => {
  const built = companion(options), value = probeXmoeCompanion(built.bytes);
  expect(value).toMatchObject(built.profile);
  expect(value?.key).toEqual(built.profile.key);
});
it("does not identify an unrelated PE or isolated native-looking text", () => {
  expect(probeXmoeCompanion(Buffer.from("not a PE image"))).toBeNull();
  const built = companion(); built.bytes.fill(0, 0x500, 0x524);
  expect(probeXmoeCompanion(built.bytes)).toBeNull();
});
it.each([undefined, 0x923712ab])("fails closed when a recognized companion has an unbacked table pointer (subtract=%s)", subtract => {
  expect(() => probeXmoeCompanion(companion({subtract, brokenReference: true}).bytes)).toThrow("RUNTIME_XMOE_UNSUPPORTED");
});
it("rejects a header routine whose field relationship no longer matches the supported format", () => {
  const built = companion(); built.bytes[0xa00 + 23] ^= 1;
  expect(() => probeXmoeCompanion(built.bytes)).toThrow("RUNTIME_XMOE_UNSUPPORTED");
});
it("rejects duplicate payload routines and honors cancellation before PE reads", () => {
  const built = companion(); built.bytes.copy(built.bytes, 0x1400, 0x500, 0x560);
  expect(() => probeXmoeCompanion(built.bytes)).toThrow("RUNTIME_XMOE_UNSUPPORTED");
  expect(() => probeXmoeCompanion(companion().bytes, AbortSignal.abort())).toThrow();
});
