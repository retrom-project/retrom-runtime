// @vitest-environment node
import {readFile} from "node:fs/promises";
import {expect, it} from "vitest";
import {runtimeCatalog} from "../src/runtime/catalog.js";

// The generated support catalog uses this TypeScript projection while servers use the Go host's `catalog`
// command; the Go golden result is that command's reviewed output, so both projections must stay equal.
it("projects the same Providers, bindings, platforms and cores as the Go host", async () => {
  const golden = JSON.parse(await readFile(new URL("../host/testdata/golden/catalog/catalog/case.json", import.meta.url), "utf8"));
  const host = golden.result as Record<string, unknown>;
  const local = JSON.parse(JSON.stringify(runtimeCatalog())) as Record<string, unknown>;
  for (const key of ["providers", "bindings", "platforms", "cores"]) {
    expect(local[key], key).toEqual(host[key]);
  }
});
