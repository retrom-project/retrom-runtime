import {access, readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

describe("Provider source authority boundary", () => {
  it("keeps upstream acquisition separate from the Provider target declaration", async () => {
    await expect(access("runtime-manifest.json")).rejects.toMatchObject({code: "ENOENT"});
    const sources = JSON.parse(await readFile("provider-sources.json", "utf8")) as Record<string, unknown>;
    expect(Object.keys(sources).sort()).toEqual([
      "localAssets", "packageName", "packageVersion", "publicApiVersion", "schemaVersion", "upstreamReleases",
    ]);
    expect(sources).not.toHaveProperty("adapters");
    expect(sources).not.toHaveProperty("cores");
  });
});
