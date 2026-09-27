// @vitest-environment node
import {expect, it} from "vitest";
import {readFile, access} from "node:fs/promises";
import {auditSource, repositorySources} from "../../scripts/content-io/boundaries.mjs";
import {contentBoundaries} from "../../src/provider/content-policies.js";

it("audits the current runtime sources in the ordinary CI gate", async () => {
  const {entries} = JSON.parse(await readFile("tests/content-io/boundaries.json", "utf8"));
  const sources = await repositorySources(process.cwd(), ["src", "assets"]);
  expect(sources.length).toBeGreaterThan(100);
  for (const source of sources) {auditSource("runtime", source.path, source.text, entries);}
  for (const path of Object.values(contentBoundaries)) {await access(path);}
});
