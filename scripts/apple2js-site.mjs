import {expandVerifiedArchive} from "./jsbeeb-site.mjs";
import siteAssets from "../src/apple2js/site-assets.json" with {type: "json"};

export async function expandApple2Site(stageRoot) {
  return expandVerifiedArchive(stageRoot, "runtime/apple2js/apple2js-site.tar.gz", "runtime/apple2js/site",
    new Set(siteAssets), 1024 * 1024, 2 * 1024 * 1024, "APPLE2JS_SITE_INVALID");
}
