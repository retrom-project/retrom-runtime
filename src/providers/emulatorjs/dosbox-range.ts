import type {ContentSourceV1} from "../../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {contentLimits} from "../../content-io/limits.js";
import {exact, integer, isDigest, validateSource} from "../../content-io/source.js";
import {fetchMetadataJson} from "../../provider/metadata.js";
import {NeoCDRange} from "./neocd-range.js";

type DOSIndexResource = {indexUrl: string; contentDigest: string};

/** The index declares the size of the virtual ZIP emitted by the server, not the source ZIP. */
export async function prepareDOSBundle(resource: DOSIndexResource, session: AdapterContentSession,
  signal: AbortSignal, fail: (error: Error) => void) {
  if (!isDigest(resource.contentDigest)) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  const indexURL = new URL(resource.indexUrl, location.href);
  const index = await fetchMetadataJson(resource.indexUrl, 4096, signal);
  if (!exact(index, ["schemaVersion", "files"]) || index.schemaVersion !== 1 ||
    !Array.isArray(index.files) || index.files.length !== 1 ||
    !exact(index.files[0], ["path", "url", "sizeBytes"])) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  const file = index.files[0];
  if (file.path !== "game.zip" || !integer(file.sizeBytes, 1, contentLimits.signedDisc) ||
    typeof file.url !== "string") {
    throw new Error("DOSBOX_CONTENT_INDEX_INVALID");
  }
  const gameURL = new URL(file.url, indexURL).href;
  const policy = session.inputPolicy("game");
  const source: ContentSourceV1 = {
    identity: {kind: "INDEX_ENTRY", projectDigest: resource.contentDigest, logicalPath: "game.zip"},
    url: gameURL, sizeBytes: file.sizeBytes, purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "PIN_STRONG", contentLengthPolicy: policy.contentLengthPolicy,
  };
  validateSource(source, {storageOrigin: location.origin, allowedOrigins: [indexURL.origin]});
  const reader = await session.open(source, policy, signal);
  const range = new NeoCDRange({sha256: resource.contentDigest, sizeBytes: file.sizeBytes}, reader, fail, "game.zip");
  try {await Promise.all([range.read(0, 1), range.read(file.sizeBytes - 1, 1)]);}
  catch (error) {await range.dispose(); throw error;}
  return {range, gameURL};
}
