import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {parseProjectIndex} from "../provider/project-index.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import type {KirikiriContent} from "./content.js";
import {kirikiriResourceOverlayFiles} from "./overlays.js";
import {installMoleboxFilesystem} from "./molebox-filesystem.js";

type ProjectFilesystem = {
  registerContent(path: string, handle: {fileId: string; sizeBytes: number}, reader: ContentReaderV1): unknown;
};
const maximumProjectFiles = 10_000;

export async function registerKirikiriProject(vlfs: ProjectFilesystem, indexUrl: string, documentBaseUrl: string,
  content: KirikiriContent, contentDigest: string, overlayRoot: string | null, overlayArchives: string[], signal?: AbortSignal) {
  let value: unknown;
  try {
    value = await fetchMetadataJson(new URL(indexUrl, documentBaseUrl), indexByteBudget(maximumProjectFiles, 1024), signal);
  } catch {throw new Error("KIRIKIRI_PROJECT_INDEX_UNAVAILABLE");}
  const index = parseProjectIndex(value, maximumProjectFiles, "EXACT");
  if (!index) {throw new Error("KIRIKIRI_PROJECT_INDEX_INVALID");}
  const base = new URL(indexUrl, documentBaseUrl), registered = [];
  const paths: string[] = [];
  const overlayFiles = kirikiriResourceOverlayFiles(index.files.map(file => file.path), overlayRoot, overlayArchives);
  for (const file of index.files) {
    const path = `/${file.path}`;
    const reader = content.register(contentDigest, file.path, new URL(file.url, base).href, file.sizeBytes);
    vlfs.registerContent(path, {fileId: reader.id, sizeBytes: reader.sizeBytes}, reader);
    registered.push({path: file.path, reader});
    paths.push(path);
  }
  await installMoleboxFilesystem(vlfs, registered, signal);
  return {paths, overlayFiles, files: registered};
}
