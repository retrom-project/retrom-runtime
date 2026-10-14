import {checkSignal} from "../content-io/abort.js";
import {ContentIOError} from "../content-io/errors.js";
import type {AdapterContentOptions} from "./content-inputs.js";
import {loadCoreAsset} from "./core-assets.js";

/** Per-instance handles over the shared digest cache. Keep handles alive until native code exits. */
export class CoreAssetURLs {
  private readonly urls = new Map<string, Promise<string>>();
  private readonly owned = new Set<string>();
  private closed = false;
  constructor(private readonly content: AdapterContentOptions, private readonly base: string, private readonly signal?: AbortSignal) {}

  url(path: string, maximum = 256 * 1024 * 1024): Promise<string> {
    if (this.closed) {return Promise.reject(new ContentIOError("ABORTED"));}
    let pending = this.urls.get(path);
    if (!pending) {
      pending = this.create(path, maximum);
      this.urls.set(path, pending);
      void pending.catch(() => {if (this.urls.get(path) === pending) {this.urls.delete(path);}});
    }
    return pending;
  }

  close() {
    this.closed = true;
    for (const url of this.owned) {URL.revokeObjectURL(url);}
    this.owned.clear(); this.urls.clear();
  }

  private async create(path: string, maximum: number) {
    const bytes = await loadCoreAsset(this.content, new URL(path, new URL(this.base, location.href)).href,
      path, maximum, this.signal);
    checkSignal(this.signal);
    if (this.closed) {throw new ContentIOError("ABORTED");}
    const type = path.endsWith(".wasm") ? "application/wasm" : /\.m?js$/u.test(path) ? "text/javascript" : "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], {type}));
    this.owned.add(url); return url;
  }
}
