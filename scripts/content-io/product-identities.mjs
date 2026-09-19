import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile, realpath} from "node:fs/promises";
import {join} from "node:path";
import {absolutePath, argumentsFor, atomicJSON, main, within} from "./cli.mjs";
import {currentCoreIdentities} from "./core-identities.mjs";
import {currentProviderIdentities} from "./provider-identities.mjs";
import {repositoryTrees} from "./repository-tree.mjs";
import {runtimeRoot, readPFB} from "./preflight.mjs";
import {artifactDigest} from "./artifacts.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export async function productIdentities(environment) {
  const context = readPFB(environment.repositories.retrom.root, environment.pfb.name);
  assert.deepEqual(context.pfb, environment.pfb, "CONTENT_IO_PRODUCT_PFB_MISMATCH");
  assert.ok(environment.tools.chrome?.path, "CONTENT_IO_CHROME_REQUIRED");
  const chrome = await realpath(environment.tools.chrome.path);
  const version = execFileSync(chrome, ["--version"], {encoding: "utf8", timeout: 15000}).trim();
  assert.equal(version, environment.tools.chrome.version, "CONTENT_IO_BROWSER_VERSION_CHANGED");
  const browser = {version, sha256: (await artifactDigest(chrome)).sha256};
  const cores = await currentCoreIdentities(environment, "S20", runtimeRoot);
  const providers = await currentProviderIdentities(environment, cores, runtimeRoot);
  const root = join(environment.repositories.retrom.root, ".pfb/workspace/providers");
  let development;
  try {development = JSON.parse(await readFile(join(root, "dev/dev-provider.json"), "utf8"));}
  catch (error) {if (error.code !== "ENOENT") throw error;}
  for (const provider of providers) {
    const installation = join(root, "installed", provider.id, provider.bundleSha256);
    provider.workerSha256 = sha(await readFile(join(installation, "assets/content-io/worker.mjs")));
    if (development?.providerId !== provider.id) continue;
    assert.equal(development.baseBundleSha256, provider.bundleSha256, "CONTENT_IO_PRODUCT_DEV_BASE_MISMATCH");
    assert.equal(development.schemaVersion, 1);
    for (const [path, field] of [["client.mjs", "moduleSha256"], ["assets/content-io/worker.mjs", "workerSha256"]]) {
      const files = development.files.filter(file => file.path === path); assert.equal(files.length, 1);
      const file = files[0], bytes = Buffer.from(file.contentBase64, "base64");
      assert.equal(bytes.length, file.sizeBytes); assert.equal(sha(bytes), file.sha256);
      provider[field] = file.sha256;
    }
  }
  return {pfbId: environment.pfb.id, browser, repositories: await repositoryTrees(environment.repositories), cores, providers};
}
async function snapshot() {
  const args = argumentsFor({env: {type: "string"}, output: {type: "string"}}, ["env", "output"]);
  if (args.help) {console.log("product-identities --env <absolute environment.json> --output <new evidence JSON>"); return;}
  const environment = JSON.parse(await readFile(await absolutePath(args.env), "utf8"));
  const output = await absolutePath(within(environment.paths.evidenceRoot, args.output), true);
  await atomicJSON(output, await productIdentities(environment));
}
main(import.meta.url, snapshot);
