import {expandVerifiedArchive} from "./jsbeeb-site.mjs";
import siteAssets from "../src/openshiina/site-assets.json" with {type: "json"};
export const shiinaSitePaths = siteAssets.map(path => `runtime/openshiina/web/${path}`);
export async function expandShiinaSite(stageRoot) {
  await expandVerifiedArchive(stageRoot, "runtime/openshiina/openshiina-web.tar.gz", "runtime/openshiina/web",
    new Set(siteAssets), 64 * 1024 * 1024, 128 * 1024 * 1024, "SHIINA_SITE_INVALID");
  return shiinaSitePaths;
}
