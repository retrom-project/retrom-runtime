import type {ContentSourceV1} from "../../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {contentLimits} from "../../content-io/limits.js";
import {exact, integer, isDigest, validateSource} from "../../content-io/source.js";
import {fetchMetadataJson} from "../../provider/metadata.js";
import {NeoCDRange} from "./neocd-range.js";
import type {EjsWindow, EjsInstance} from "./emulator-instance.js";
import type {LaunchEnvelopeV1, RuntimeCheckpointAvailabilityV1} from "../../provider/module-api.js";
import {resource} from "./resources.js";
import {dosAutobootSuffix, DOSAutobootRange} from "./dosbox-autoboot.js";

export function dosCheckpointAvailability(instance: EjsInstance | null): RuntimeCheckpointAvailabilityV1 {
  const ready = instance?.gameManager?.Module?._retrom_dos_state_ready;
  if (!ready) {return {available: false, reason: "NOT_READY"};}
  try {if (ready() === 1) {return {available: true, reason: null};}} catch {return {available: false, reason: "NOT_READY"};}
  return {available: false, reason: "PROGRAM_SELECTION_REQUIRED", requiredAction: "SELECT_PROGRAM"};
}

/** The DOS core starts its selected program after EmulatorJS's game-start event. */
export function observeDOSCheckpointAvailability(runtimeWindow: Window, instance: EjsInstance,
  update: (availability: RuntimeCheckpointAvailabilityV1) => void) {
  const timer = runtimeWindow.setInterval(() => update(dosCheckpointAvailability(instance)), 200);
  return () => runtimeWindow.clearInterval(timer);
}

export async function configureDOSContentDisc(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1,
  session: AdapterContentSession, signal: AbortSignal, fail: (error: Error) => void) {
  const entryPath = envelope.targetOptions.dosEntryPath;
  if (entryPath !== null && typeof entryPath !== "string") {throw new Error("DOSBOX_ENTRY_INVALID");}
  const bundle = await prepareDOSBundle(resource(envelope, "game", "FILE_TREE"), session, signal, fail, entryPath);
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_DOSBOX_RANGE_V1"], bundle.range.filename);
  return {range: bundle.range, cleanup: null};
}

type DOSIndexResource = {indexUrl: string; contentDigest: string};

/** The index declares the size of the virtual ZIP emitted by the server, not the source ZIP. */
export async function prepareDOSBundle(resource: DOSIndexResource, session: AdapterContentSession,
  signal: AbortSignal, fail: (error: Error) => void, entryPath: string | null = null) {
  if (!isDigest(resource.contentDigest)) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  const indexURL = new URL(resource.indexUrl, location.href);
  const index = await fetchMetadataJson(resource.indexUrl, 4096, signal);
  if (!exact(index, ["schemaVersion", "files"]) || index.schemaVersion !== 1 ||
    !Array.isArray(index.files) || index.files.length !== 1 ||
    !exact(index.files[0], ["path", "url", "sizeBytes", "sha256", "mediaType"])) {throw new Error("DOSBOX_CONTENT_INDEX_INVALID");}
  const file = index.files[0];
  if (file.path !== "game.zip" || !integer(file.sizeBytes, 1, contentLimits.signedDisc) ||
    typeof file.url !== "string" || !isDigest(file.sha256) ||
    typeof file.mediaType !== "string" || file.mediaType.length === 0) {
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
  const disc = {sha256: resource.contentDigest, sizeBytes: file.sizeBytes};
  let range = new NeoCDRange(disc, reader, fail, "game.zip");
  try {
    if (entryPath !== null) {range = new DOSAutobootRange(disc, reader, fail, await dosAutobootSuffix(range, entryPath));}
    await Promise.all([range.read(0, 1), range.read(range.sizeBytes - 1, 1)]);
  }
  catch (error) {await range.dispose(); throw error;}
  return {range, gameURL};
}
