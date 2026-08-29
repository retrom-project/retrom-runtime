import { access, readFile } from "node:fs/promises";
import { loadManifest, sha256 } from "./manifest.mjs";

const root = new URL("../", import.meta.url);
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
console.log(`package-check: ok (${manifest.cores.length} cores)`);
