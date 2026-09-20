import type {ContentDiagnostic} from "../content-io/session-diagnostics.js";
import type {TargetDeclaration} from "./declarations.js";
import type {AssetIndexV1, LaunchEnvelopeV1, RuntimeResourceV1} from "./module-api.js";
import {bootstrapContentSession} from "../content-io/bootstrap.js";
import type {ContentSessionClient} from "../content-io/client.js";
import {ContentIOError} from "../content-io/errors.js";
/** Provider lifecycle owns the service; adapters own only file/consumer references. */
export class ProviderContentOwner {
  private readonly controller = new AbortController();
  private session: ContentSessionClient | null = null;
  private stopped = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly failure: (error: Error) => void, private readonly diagnostic: (diagnostic: ContentDiagnostic) => void = () => {}) {}
  async start(target: TargetDeclaration, envelope: LaunchEnvelopeV1, index: AssetIndexV1): Promise<ContentSessionClient | null> {
    const managed = Object.values(target.contentIO).some((policy) => policy.mode !== "BROWSER_NATIVE" && policy.mode !== "UPSTREAM_LOADER");
    if (!managed) {return null;}
    if (this.stopped) {throw new DOMException("Aborted", "AbortError");}
    const runtimeBaseURL = new URL(envelope.runtime.runtimeBaseUrl, location.href).href;
    const origins = new Set([location.origin, new URL(runtimeBaseURL).origin]);
    for (const resource of envelope.resources) {for (const url of resourceURLs(resource)) {origins.add(new URL(url, location.href).origin);}}
    let session: ContentSessionClient;
    try {
      session = await bootstrapContentSession({runtimeBaseURL, assetIndex: index, storageOrigin: location.origin,
        allowedOrigins: [...origins], signal: this.controller.signal, onFailure: this.failure, onDiagnostic: this.diagnostic});
    } catch (error) {if (this.stopped) {throw new DOMException("Aborted", "AbortError");} throw error;}
    if (this.stopped) {await session.close(); throw new DOMException("Aborted", "AbortError");}
    this.session = session; return session;
  }
  force(reason = new ContentIOError("ABORTED")): void {
    this.stopped = true; this.controller.abort(reason); this.session?.fail(reason);
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.stopped = true; this.controller.abort();
      this.closing = this.session?.close() ?? Promise.resolve();
    }
    return this.closing;
  }
}
function resourceURLs(resource: RuntimeResourceV1): string[] {
  switch (resource.kind) {
    case "ROM_BLOB": case "SEEKABLE_BLOB": case "PARENT_ARCHIVE": case "WASM4_CART": return [resource.url];
    case "FILE_TREE": return [resource.indexUrl];
    case "BIOS_BUNDLE": case "EXTERNAL_FILE_SET": return resource.files.map((file) => file.url);
    case "MULTI_DISC": return resource.entries.map((entry) => entry.url);
    default: return [];
  }
}
