import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {absolutePath} from "./cli.mjs";
import {audit} from "./boundaries.mjs";
test("[PK-06] CONTRACT/current-boundaries audits every current runtime and fork I/O operation", async context => {
  const environment = JSON.parse(await readFile(await absolutePath(process.env.CONTENT_IO_ENV), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../../tests/content-io/boundaries.json", import.meta.url), "utf8"));
  const result = await audit(environment, catalog.entries);
  assert.ok(result.length > 0); context.diagnostic(JSON.stringify(result));
});
