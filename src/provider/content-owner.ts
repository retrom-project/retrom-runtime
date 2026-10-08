import type {ContentDiagnostic} from "../content-io/session-diagnostics.js";
import type {TargetDeclaration} from "./declarations.js";
import type {AssetIndexV1, LaunchEnvelopeV1, RuntimeResourceV1} from "./module-api.js";
import {bootstrapContentSession} from "../content-io/bootstrap.js";
import type {ContentSessionClient} from "../content-io/client.js";
import {ContentIOError} from "../content-io/errors.js";
import {ProviderContentPreload, type PreloadProgress} from "./content-preload.js";
import {preloadSources} from "./preload-sources.js";
import {withStartupTask, type StartupTasks} from "./startup.js";
/** Provider lifecycle owns the service; adapters own only file/consumer references. */
export class ProviderContentOwner {
  private readonly controller = new AbortController();
  private session: ContentSessionClient | null = null;
  private preload?: ProviderContentPreload;
  private stopped = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly failure: (error: Error) => void, private readonly diagnostic: (diagnostic: ContentDiagnostic) => void = () => {}) {}
  get signal(): AbortSignal {return this.controller.signal;}
  async start(target: TargetDeclaration, envelope: LaunchEnvelopeV1, index: AssetIndexV1,
    loading: "ON_DEMAND" | "PRELOAD" = "ON_DEMAND", report: PreloadProgress = () => {}, startup?: StartupTasks): Promise<ContentSessionClient | null> {
    const managed = envelope.resources.some(resource => {
      const policy = target.contentIO[resource.role];
      return policy && "bridge" in policy;
    });
    if (!managed) {return null;}
    if (this.stopped) {throw new DOMException("Aborted", "AbortError");}
    const runtimeBaseURL = new URL(envelope.runtime.runtimeBaseUrl, location.href).href;
    const origins = new Set([location.origin, new URL(runtimeBaseURL).origin]);
    for (const resource of envelope.resources) {for (const url of resourceURLs(resource)) {origins.add(new URL(url, location.href).origin);}}
    let session: ContentSessionClient;
    try {
      if (loading === "PRELOAD") {
        const context = {storageOrigin: location.origin, allowedOrigins: [...origins]};
        const sources = await preloadSources(target, envelope, index, context, this.controller.signal);
        this.preload = new ProviderContentPreload();
        await withStartupTask(startup, "GAME_CONTENT", task => this.preload!.prepare(sources, context, runtimeBaseURL, index, this.controller.signal,
          (loaded, total) => {task?.progress(loaded, total); report(loaded, total);}));
      }
      session = await withStartupTask(startup, "ENVIRONMENT", () => bootstrapContentSession({runtimeBaseURL, assetIndex: index, storageOrigin: location.origin,
        allowedOrigins: [...origins], signal: this.controller.signal, onFailure: this.failure, onDiagnostic: this.diagnostic}));
    } catch (error) {if (this.stopped) {throw new DOMException("Aborted", "AbortError");} throw error;}
    if (this.stopped) {await session.close(); throw new DOMException("Aborted", "AbortError");}
    session.preloaded = loading === "PRELOAD";
    this.session = session; return session;
  }
  force(reason = new ContentIOError("ABORTED")): void {
    this.preload?.close();
    this.stopped = true; this.controller.abort(reason); this.session?.fail(reason);
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.stopped = true; this.controller.abort();
      this.preload?.close();
      this.closing = this.session?.close() ?? Promise.resolve();
    }
    return this.closing;
  }
}
function resourceURLs(resource: RuntimeResourceV1): string[] {
  switch (resource.kind) {
    case "ROM_BLOB": case "SEEKABLE_BLOB": case "PARENT_ARCHIVE": case "WASM4_CART": return [resource.url];
    case "FILE_TREE": case "NATIVE_WEB": case "ISOLATED_WEB": return [resource.indexUrl];
    case "BIOS_BUNDLE": case "EXTERNAL_FILE_SET": return resource.files.map((file) => file.url);
    default: return [];
  }
}
