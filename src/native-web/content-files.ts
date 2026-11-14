import {rpgPluginTextPath} from "../runtime/rpg-plugin-paths.js";
import {decodeMvImage, mvImageKey, validateMvImage} from "./mv-images.js";
import type {ContentSourceV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import type {ProgressContentReader} from "../content-io/range-reader.js";
import type {ReadProgress} from "../content-io/scheduler.js";
import {ContentIOError} from "../content-io/errors.js";
import {canonicalPath, integer, record} from "../content-io/source.js";
import type {ContentSessionAccess} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import type {RuntimeWebResourceV1} from "../provider/module-api.js";

type File = {source: ContentSourceV1; mediaType: string; reader?: Promise<ProgressContentReader>;
  imageKey?: Uint8Array; imageHeader?: Promise<void>};
export class NativeContentFiles {
  private readonly files = new Map<string, File>();
  private readonly folded = new Map<string, string | null>();
  private nativeAudio = false;
  private entryFile = "";
  private closed = false;
  constructor(private readonly session: ContentSessionAccess, private readonly policy: ManagedInputPolicyV1,
    private readonly signal?: AbortSignal) {}
  async load(resource: RuntimeWebResourceV1, rpgMakerMv = false): Promise<void> {
    this.nativeAudio = resource.kind === "NATIVE_WEB";
    this.entryFile = resource.entryFile;
    const base = new URL(resource.indexUrl, location.href);
    const value = await fetchMetadataJson(base, indexByteBudget(100_000, 4096), this.signal);
    if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.files) || value.files.length > 100_000) {throw invalid();}
    for (const item of value.files) {
      const {path, file} = parseEntry(item, base, resource.contentDigest, this.policy.maxFileBytes);
      if (this.files.has(path)) {throw invalid();}
      this.files.set(path, file);
      const folded = asciiFold(path);
      this.folded.set(folded, this.folded.has(folded) ? null : path);
    }
    if (!canonicalPath(resource.entryFile) || !this.files.has(resource.entryFile)) {throw invalid();}
    if (rpgMakerMv && this.nativeAudio) {await this.prepareMvImages();}
  }
  async request(value: unknown, progress?: ReadProgress): Promise<Record<string, unknown>> {
    if (this.closed || this.signal?.aborted) {throw new ContentIOError("ABORTED");}
    if (!record(value) || typeof value.path !== "string" || !canonicalPath(value.path)) {throw invalid();}
    const name = this.resolve(value.path.normalize("NFC"));
    const file = name ? this.files.get(name) : undefined;
    if (!file) {return {status: 404};}
    const sizeBytes = file.source.sizeBytes - (file.imageKey ? 16 : 0);
    if (value.type === "STAT") {return {status: 200, path: name, sizeBytes, mediaType: file.mediaType};}
    if (value.type !== "READ" || !integer(value.offset) || !integer(value.length, 0, 262144) ||
      value.offset > sizeBytes || value.length > sizeBytes - value.offset) {throw invalid();}
    const bytes = await this.readContent(file, value.offset, value.length, progress);
    return {status: 200, bytes};
  }
  private async readContent(file: File, offset: number, length: number, progress?: ReadProgress) {
    const key = file.imageKey;
    if (!key) {return this.read(file, offset, length, progress);}
    if (length > 0) {
      file.imageHeader ??= this.read(file, 0, 32, progress).then(bytes => validateMvImage(bytes, key));
      await file.imageHeader;
    }
    return decodeMvImage(await this.read(file, offset + 16, length, progress), key, offset);
  }
  private async read(file: File, offset: number, length: number, progress?: ReadProgress) {
    file.reader ??= this.session.open(file.source, this.policy, this.signal);
    const reader = await file.reader;
    const bytes = new Uint8Array(length);
    await reader.readInto(offset, bytes, this.signal, undefined, progress);
    return bytes;
  }
  private async prepareMvImages() {
    const root = this.entryFile.slice(0, this.entryFile.lastIndexOf("/") + 1);
    const imageRoot = asciiFold(root + "img/");
    const images = [...this.files].filter(([path, file]) => asciiFold(path).startsWith(imageRoot) &&
      /\.rpgmvp$/iu.test(path) && file.source.sizeBytes >= 32 && this.folded.get(asciiFold(path)) !== null &&
      this.find(path.slice(0, -7) + ".png") === undefined);
    if (!images.length) {return;}
    const systemPath = this.find(root + "data/System.json");
    const system = systemPath ? this.files.get(systemPath) : undefined;
    if (!system) {return;}
    if (system.source.sizeBytes > 8 * 1024 * 1024) {throw invalid();}
    const bytes = new Uint8Array(system.source.sizeBytes);
    for (let offset = 0; offset < bytes.length; offset += 262144) {
      bytes.set(await this.read(system, offset, Math.min(262144, bytes.length - offset)), offset);
    }
    const key = mvImageKey(bytes);
    if (!key) {return;}
    // Some desktop plugins request images while their script loads, before MV
    // initializes Decrypter from System.json. Expose a seekable PNG view while
    // keeping transport, cache identity and stored game bytes encrypted.
    for (const [path, file] of images) {
      const pngPath = path.slice(0, -7) + ".png";
      if (this.find(pngPath) !== undefined) {continue;}
      this.files.set(pngPath, {source: file.source, mediaType: "image/png", imageKey: key});
      this.folded.set(asciiFold(pngPath), pngPath);
    }
  }
  /** Preload bounded plugin text; engine data and media remain demand-paged. */
  async prepareRpgPluginFiles(): Promise<Array<{path: string; data: ArrayBuffer}>> {
    const selected = [...this.files].filter(([path]) => rpgPluginTextPath(this.entryFile, path) !== null);
    const total = selected.reduce((size, [, file]) => size + file.source.sizeBytes, 0);
    if (selected.length > 4096 || total > 16 * 1024 * 1024) {throw new Error("RPG_PLUGIN_FILES_TOO_LARGE");}
    const result: Array<{path: string; data: ArrayBuffer}> = [];
    for (const [path, file] of selected) {
      const bytes = new Uint8Array(file.source.sizeBytes);
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        const reply = await this.request({type: "READ", path, offset, length: Math.min(262144, bytes.length - offset)});
        bytes.set(reply.bytes as Uint8Array, offset);
      }
      result.push({path: rpgPluginTextPath(this.entryFile, path)!, data: bytes.buffer});
    }
    return result;
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.files.values()].map(async file => (await file.reader)?.close()));
    this.files.clear(); this.folded.clear();
  }
  private find(path: string) {return this.files.has(path) ? path : this.folded.get(asciiFold(path));}
  private resolve(path: string) {
    const name = this.find(path);
    if (name !== undefined || !this.nativeAudio) {return name;}
    const alternative = alternateAudioPath(path);
    return alternative ? this.find(alternative) : undefined;
  }
}
function alternateAudioPath(path: string) {
  const match = /(?:^|\/)audio\/(?:bgm|bgs|me|se)\/[^/]+\.(ogg|m4a|rpgmvo|rpgmvm)$/iu.exec(path);
  if (!match) {return null;}
  const formats: Record<string, string> = {ogg: "m4a", m4a: "ogg", rpgmvo: "rpgmvm", rpgmvm: "rpgmvo"};
  const extension = match[1]!.toLowerCase();
  return path.slice(0, -extension.length) + formats[extension];
}
function asciiFold(value: string) {return value.replace(/[A-Z]/gu, character => character.toLowerCase());}
function invalid() {return new ContentIOError("SOURCE_INVALID");}

function parseEntry(item: unknown, base: URL, digest: string, maximum: number): {path: string; file: File} {
  if (!record(item) || typeof item.path !== "string" || !canonicalPath(item.path) ||
    !integer(item.sizeBytes, 0, maximum) || typeof item.url !== "string" ||
    typeof item.mediaType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/u.test(item.mediaType)) {throw invalid();}
  const url = new URL(item.url, base);
  if (url.origin !== base.origin || url.username || url.password || url.hash) {throw invalid();}
  return {path: item.path, file: {mediaType: item.mediaType, source: {
    identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: item.path},
    url: url.href, sizeBytes: item.sizeBytes, purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT",
  }}};
}
