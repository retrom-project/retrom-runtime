import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {unzipSync} from "fflate";
import {contentLimits} from "../../content-io/limits.js";
import {fetchMetadataJson} from "../../provider/metadata.js";
import {NeoCDRange} from "./neocd-range.js";
import {loadCoreAsset} from "../../provider/core-assets.js";
import type {AssetIndexV1} from "../../provider/module-api.js";
import type {AdapterContentOptions} from "../../provider/content-inputs.js";
import type {TargetDeclaration} from "../../provider/declarations.js";
import type {LaunchEnvelopeV1} from "../../provider/module-api.js";

type ProjectFile = {path: string; url: string; sizeBytes: number};
type ProjectResource = {indexUrl: string; contentDigest: string};
export type DaphneProject = {romName: string; files: ReadonlyMap<string, Uint8Array>;
  assets: ReadonlyMap<string, Uint8Array>; video: NeoCDRange};
export function daphneVideo(project: DaphneProject | null): NeoCDRange | null {return project?.video ?? null;}
export function daphneGameFile(runtimeWindow: Window, project: DaphneProject | null, fallback: string): File | string {
  return project ? new (runtimeWindow as Window & typeof globalThis).File(["RETROM_DAPHNE_PROJECT_V1"], project.romName) : fallback;
}

export async function maybePrepareDaphneProject(target: TargetDeclaration, envelope: LaunchEnvelopeV1,
  session: AdapterContentSession | null, assetIndex: AssetIndexV1, signal: AbortSignal, fail: (error: Error) => void,
  report: (readyBytes: number, totalBytes: number) => void): Promise<DaphneProject | null> {
  if (target.implementation.runtimeCore !== "daphne") {return null;}
  const resource = envelope.resources.find(entry => entry.role === "game");
  if (!session || resource?.kind !== "FILE_TREE") {throw new Error("DAPHNE_PROJECT_INVALID");}
  const project = await prepareDaphneProject(resource, session, signal, fail, report);
  try {project.assets = await prepareDaphneAssets(envelope.runtime.runtimeBaseUrl, signal,
    {contentSession: session, assetIndex}, target.assetPaths.find(path => path.endsWith("/daphne-resources.zip")) ?? "");}
  catch (error) {await project.video.dispose(); throw error;}
  return project;
}

export async function prepareDaphneAssets(runtimeBaseUrl: string, signal: AbortSignal,
  content: AdapterContentOptions, assetPath: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const url = new URL(assetPath, new URL(runtimeBaseUrl, location.href)).href;
  const bytes = await loadCoreAsset(content, url, assetPath, 8 * 1024 * 1024, signal);
  let total = 0;
  const paths = new Set<string>();
  const entries = Object.entries(unzipSync(bytes, {filter: entry => {
    const path = entry.name;
    total += entry.originalSize;
    if (!/^(?:pics\/[a-z0-9._-]+\.bmp|sound\/[a-z0-9._-]+\.(?:wav|ogg))$/iu.test(path) ||
      path.includes("..") || paths.has(path) || total > 8 * 1024 * 1024 || paths.size >= 200) {
      throw new Error("DAPHNE_ASSETS_INVALID");
    }
    paths.add(path); return true;
  }}));
  if (entries.length < 20) {throw new Error("DAPHNE_ASSETS_INVALID");}
  return new Map(entries);
}

function projectFiles(value: unknown, romDigest: string): ProjectFile[] {
  if (!/^[a-f0-9]{64}$/u.test(romDigest) || !value || typeof value !== "object" ||
    (value as {schemaVersion?: unknown}).schemaVersion !== 1 ||
    !Array.isArray((value as {files?: unknown}).files)) {throw new Error("DAPHNE_PROJECT_INVALID");}
  const entries = (value as {files: unknown[]}).files;
  if (entries.length < 3 || entries.length > 16) {throw new Error("DAPHNE_PROJECT_INVALID");}
  const seen = new Set<string>();
  let total = 0;
  const files = entries.map(entry => {
    const file = entry as Partial<ProjectFile> | null;
    if (!file || typeof file.path !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}\.(?:zip|txt|m2v|dat|ogg)$/iu.test(file.path) ||
      file.path.includes("..") || typeof file.url !== "string" || !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes! < 1 || file.sizeBytes! > contentLimits.signedDisc || seen.has(file.path.toLowerCase())) {
      throw new Error("DAPHNE_PROJECT_INVALID");
    }
    seen.add(file.path.toLowerCase()); total += file.sizeBytes!;
    if (total > contentLimits.signedDisc) {throw new Error("DAPHNE_PROJECT_INVALID");}
    return file as ProjectFile;
  });
  const roms = files.filter(file => file.path.toLowerCase().endsWith(".zip"));
  const videos = files.filter(file => file.path.toLowerCase().endsWith(".m2v"));
  if (roms.length !== 1 || videos.length !== 1 ||
    !seen.has(roms[0].path.slice(0, -4).toLowerCase() + ".txt")) {throw new Error("DAPHNE_PROJECT_INVALID");}
  return files;
}

export async function prepareDaphneProject(resource: ProjectResource, session: AdapterContentSession,
  signal: AbortSignal, fail: (error: Error) => void,
  report: (readyBytes: number, totalBytes: number) => void = () => {}): Promise<DaphneProject> {
  const indexUrl = new URL(resource.indexUrl, location.href);
  const files = projectFiles(await fetchMetadataJson(indexUrl, 128 * 1024, signal), resource.contentDigest);
  const rom = files.find(file => file.path.toLowerCase().endsWith(".zip"))!;
  const video = files.find(file => file.path.toLowerCase().endsWith(".m2v"))!;
  const bytes = new Map<string, Uint8Array>();
  const eagerTotal = files.filter(file => file !== video).reduce((sum, file) => sum + file.sizeBytes, 0);
  if (eagerTotal > 128 * 1024 * 1024) {throw new Error("DAPHNE_PROJECT_INVALID");}
  let ready = 0;
  const source = (file: ProjectFile, policy: ReturnType<AdapterContentSession["inputPolicy"]>) => {
    const url = new URL(file.url, indexUrl);
    if (url.origin !== indexUrl.origin || !url.pathname.startsWith(indexUrl.pathname.slice(0, -"index.json".length))) {
      throw new Error("DAPHNE_PROJECT_INVALID");
    }
    return {identity: {kind: "INDEX_ENTRY" as const, projectDigest: resource.contentDigest, logicalPath: file.path},
      url: url.href, sizeBytes: file.sizeBytes, purpose: "GAME" as const,
      transport: policy.mode === "RANGE" ? "RANGE_REQUIRED" as const : "WHOLE_ALLOWED" as const,
      etagPolicy: "PIN_STRONG" as const, contentLengthPolicy: policy.contentLengthPolicy};
  };
  for (const file of files) {
    if (file === video) {continue;}
    if (file.sizeBytes > contentLimits.firmwareFile) {throw new Error("DAPHNE_PROJECT_INVALID");}
    const policy = session.inputPolicy("game", "support");
    const reader = await session.open(source(file, policy), policy, signal);
    try {
      const result = await session.materialize(reader.id, {kind: "BYTES", maxBytes: policy.maxFileBytes}, signal,
        progress => report(ready + progress.readyBytes, eagerTotal));
      if (result.kind !== "BYTES" || result.bytes.byteLength !== file.sizeBytes) {throw new Error("DAPHNE_PROJECT_LENGTH_MISMATCH");}
      bytes.set(file.path, result.bytes); ready += result.bytes.byteLength; report(ready, eagerTotal);
    } finally {await reader.close();}
  }
  const policy = session.inputPolicy("game");
  const reader = await session.open(source(video, policy), policy, signal);
  const videoRange = new NeoCDRange({sha256: resource.contentDigest, sizeBytes: video.sizeBytes}, reader, fail, video.path);
  try {await Promise.all([videoRange.read(0, 1), videoRange.read(video.sizeBytes - 1, 1)]);}
  catch (error) {await videoRange.dispose(); throw error;}
  return {romName: rom.path, files: bytes, assets: new Map(), video: videoRange};
}

type DaphneInstance = {fileName?: string; downloadRom?: () => Promise<void>; on?: (event: string, callback: () => void) => void;
  gameManager?: {writeFile?: (path: string, bytes: Uint8Array) => void}};

/** EJS copies the small project members after its FS is ready; the video node is replaced by the shared Range mount. */
export function installDaphneProject(instance: DaphneInstance, project: DaphneProject, fail: (error: Error) => void): () => void {
  if (!instance.on || !instance.downloadRom) {throw new Error("DAPHNE_RUNTIME_UNAVAILABLE");}
  const original = instance.downloadRom;
  let closed = false;
  instance.downloadRom = async () => {instance.fileName = `roms/${project.romName}`;};
  instance.on("saveDatabaseLoaded", () => {
    if (closed) {return;}
    try {
      const write = instance.gameManager?.writeFile;
      if (!write) {throw new Error("DAPHNE_RUNTIME_UNAVAILABLE");}
      for (const [path, contents] of project.assets) {write.call(instance.gameManager, `/${path}`, contents);}
      for (const [path, contents] of project.files) {
        write.call(instance.gameManager, path === project.romName ? `/roms/${path}` : `/framefile/${path}`, contents);
      }
      write.call(instance.gameManager, `/framefile/${project.video.filename}`, new Uint8Array([0]));
    } catch (error) {fail(error instanceof Error ? error : new Error("DAPHNE_MOUNT_FAILED"));}
  });
  return () => {closed = true; instance.downloadRom = original;};
}

export function maybeInstallDaphneProject(instance: DaphneInstance, project: DaphneProject | null,
  fail: (error: Error) => void): (() => void) | null {
  try {return project ? installDaphneProject(instance, project, fail) : null;}
  catch (error) {fail(error instanceof Error ? error : new Error("DAPHNE_RUNTIME_UNAVAILABLE")); return null;}
}
