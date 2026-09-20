import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {absolutePath} from "./cli.mjs";
import {runtimeRoot} from "./preflight.mjs";
import {currentCoreIdentities} from "./core-identities.mjs";
import {currentProviderIdentities} from "./provider-identities.mjs";
test("[PK-04] CONTRACT/current-providers [PK-03] CONTRACT/installed-base verifies the current source, candidate bytes, core artifacts and imported PFB base", async context => {
  const environment = JSON.parse(await readFile(await absolutePath(process.env.CONTENT_IO_ENV), "utf8"));
  const cores = await currentCoreIdentities(environment, "S18", runtimeRoot);
  const providers = await currentProviderIdentities(environment, cores, runtimeRoot);
  assert.deepEqual(providers.map(provider => provider.id), ["emulatorjs", "retrom-runtime"]);
  context.diagnostic(JSON.stringify(providers));
});
