import { describe, expect, it } from "vitest";
import { parseDevReleaseOverrides } from "../scripts/dev-release-overrides.mjs";

const releases = [{ id: "onsyuri" }, { id: "kirikiri2" }];

describe("local fork release overrides", () => {
  it("rejects local core bytes in formal release builds", () => {
    expect(() => parseDevReleaseOverrides(JSON.stringify({onsyuri: "/work/output"}), releases, true))
      .toThrowError("DEV_RELEASE_OVERRIDES_FORBIDDEN");
    expect([...parseDevReleaseOverrides("{}", releases, true)]).toEqual([]);
  });
  it("accepts explicit absolute roots for known release ids", () => {
    expect([...parseDevReleaseOverrides(
      JSON.stringify({ onsyuri: "/work/ons-output", kirikiri2: "/work/kiri-output" }),
      releases,
    )]).toEqual([
      ["onsyuri", "/work/ons-output"],
      ["kirikiri2", "/work/kiri-output"],
    ]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["an array", "[]"],
    ["an unknown runtime", JSON.stringify({ other: "/work/output" })],
    ["a relative path", JSON.stringify({ onsyuri: "output" })],
  ])("rejects %s", (_label, value) => {
    expect(() => parseDevReleaseOverrides(value, releases))
      .toThrowError("DEV_RELEASE_OVERRIDES_INVALID");
  });
});
