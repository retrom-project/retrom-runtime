import {expandVerifiedArchive} from "./jsbeeb-site.mjs";

export function expandSamCoupeSite(stageRoot) {
  return expandVerifiedArchive(stageRoot, "runtime/samcoupeweb/samcoupeweb-wasm.data", "runtime/samcoupeweb",
    new Set(["samcoupeweb.js", "samcoupeweb.wasm", "samcoupeweb.data"]),
    4 * 1024 * 1024, 8 * 1024 * 1024, "SAMCOUPE_SITE_INVALID");
}
