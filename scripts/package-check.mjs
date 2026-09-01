import { access, readFile } from "node:fs/promises";
import { loadManifest, sha256 } from "./manifest.mjs";

const root = new URL("../", import.meta.url);
await rejectCandidateDeclaration(root);
const manifest = await loadManifest(root);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (packageJson.version !== manifest.packageVersion) {throw new Error("PACKAGE_VERSION_MISMATCH");}
await Promise.all([
  access(new URL("dist/index.js", root)),
  access(new URL("dist/index.d.ts", root)),
  ...manifest.localAssets.map(async (asset) => {
    const contents = await readFile(new URL(asset.source, root));
    if (!contents.length || sha256(contents).length !== 64) {throw new Error("LOCAL_ASSET_INVALID");}
  }),
]);
const declarations = await readFile(new URL("dist/index.d.ts", root), "utf8");
if (/\b(?:RpgRuntime|RpgGeneration|RpgPosition)\b|create(?:Rpg|Ons|Kirikiri)Runtime/u.test(declarations)) {
  throw new Error("LEGACY_PUBLIC_RUNTIME_API_PRESENT");
}
console.log(`package-check: ok (${manifest.cores.length} cores)`);

async function rejectCandidateDeclaration(base) {
  try {
    await access(new URL("candidate/runtime-candidate.json", base));
  } catch (error) {
    if (error?.code === "ENOENT") {return;}
    throw error;
  }
  if (process.env.RETROM_PFB_CANDIDATE_BUILD !== "1") {
    throw new Error("PFB_CANDIDATE_FORBIDDEN");
  }
}
