import { access, readFile } from "node:fs/promises";
import { loadProviderSources, sha256 } from "./provider-sources.mjs";
import {fileURLToPath} from "node:url";
import {verifyRuntimePackage} from "./verify-runtime-package.mjs";
import {buildIsolatedBridges} from "./build-isolated-bridges.mjs";

const root = new URL("../", import.meta.url);
await buildIsolatedBridges(true);
await rejectRetiredCandidateDeclaration(root);
const sources = await loadProviderSources(root);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if ("version" in packageJson || "packageVersion" in sources) {throw new Error("PROVIDER_VERSION_MUST_COME_FROM_TAG");}
await Promise.all([
  access(new URL("dist/index.js", root)),
  access(new URL("dist/index.d.ts", root)),
  ...sources.localAssets.map(async (asset) => {
    const contents = await readFile(new URL(asset.source, root));
    if (!contents.length || sha256(contents).length !== 64) {throw new Error("LOCAL_ASSET_INVALID");}
  }),
]);
const declarations = await readFile(new URL("dist/index.d.ts", root), "utf8");
if (/\b(?:GameRuntime|RuntimeConfig|RpgRuntime|RpgGeneration|RpgPosition)\b|(?:create(?:Rpg|Ons|Kirikiri)|mount|describe)Runtime|runtimeAdapters|validateRuntimeConfig/u.test(declarations)) {
  throw new Error("LEGACY_PUBLIC_RUNTIME_API_PRESENT");
}
const hostTool = await verifyRuntimePackage(fileURLToPath(root), packageJson);
console.log(`package-check: ok (${sources.upstreamReleases.length} upstream inputs; ${hostTool.files} package files; catalog/configure/prepare; detector ${hostTool.detector})`);

async function rejectRetiredCandidateDeclaration(base) {
  try {
    await access(new URL("candidate/runtime-candidate.json", base));
  } catch (error) {
    if (error?.code === "ENOENT") {return;}
    throw error;
  }
  throw new Error("PROVIDER_TARGET_DECLARATION_REQUIRED");
}
