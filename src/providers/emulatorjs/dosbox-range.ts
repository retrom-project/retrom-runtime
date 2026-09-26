import type {ContentSourceV1} from "../../../contracts/content-io/v1/content-io.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {contentLimits} from "../../content-io/limits.js";
import {exact, integer, isDigest} from "../../content-io/source.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {fetchMetadataJson} from "../../provider/metadata.js";
import {NeoCDRange} from "./neocd-range.js";

type DOSIndexResource = {indexUrl: string; contentDigest: string};

export function dosGameURL(resource: DOSIndexResource): string {
  if (!isDigest(resource.contentDigest)) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  const indexURL = new URL(resource.indexUrl, location.href);
  if (indexURL.origin !== location.origin ||
    indexURL.pathname !== `/runtime/content/game/${resource.contentDigest}/index.json` ||
    indexURL.search || indexURL.hash) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  return new URL("game.zip", indexURL).href;
}

/** The index declares the size of the virtual ZIP emitted by the server, not the source ZIP. */
export async function prepareDOSBundle(resource: DOSIndexResource, session: ContentSessionClient,
  signal: AbortSignal, fail: (error: Error) => void) {
  const gameURL = dosGameURL(resource);
  const index = await fetchMetadataJson(resource.indexUrl, 4096, signal);
  if (!exact(index, ["schemaVersion", "files"]) || index.schemaVersion !== 1 ||
    !Array.isArray(index.files) || index.files.length !== 1 ||
    !exact(index.files[0], ["path", "url", "sizeBytes"])) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  const file = index.files[0];
  if (file.path !== "game.zip" || !integer(file.sizeBytes, 1, contentLimits.signedDisc) ||
    typeof file.url !== "string" || new URL(file.url, location.href).href !== gameURL) {
    throw new Error("DOSBOX_CONTENT_INDEX_INVALID");
  }
  const policy = rangePolicy("ASYNC", contentLimits.signedDisc);
  const source: ContentSourceV1 = {
    identity: {kind: "INDEX_ENTRY", projectDigest: resource.contentDigest, logicalPath: "game.zip"},
    url: gameURL, sizeBytes: file.sizeBytes, purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "PIN_STRONG", contentLengthPolicy: policy.contentLengthPolicy,
  };
  const reader = await session.open(source, policy, signal);
  const range = new NeoCDRange({sha256: resource.contentDigest, sizeBytes: file.sizeBytes}, reader, fail, "game.zip");
  try {await Promise.all([range.read(0, 1), range.read(file.sizeBytes - 1, 1)]);}
  catch (error) {await range.dispose(); throw error;}
  return {range, gameURL};
}
