import {installCoreAssetFetch} from "../../provider/core-asset-fetch.js";
import {CoreAssetURLs} from "../../provider/core-asset-urls.js";
import type {AdapterContentOptions} from "../../provider/content-inputs.js";
import type {EjsWindow} from "./emulator-instance.js";
import {fileName} from "./resources.js";

/** One lifetime for the verified archive and additional native asset fetches. */
export class EmulatorCoreAssets {
  private readonly urls: CoreAssetURLs;
  private readonly restoreFetch: () => void;
  constructor(private readonly win: EjsWindow, content: AdapterContentOptions, private readonly base: string, signal: AbortSignal) {
    this.urls = new CoreAssetURLs(content, base, signal);
    this.restoreFetch = installCoreAssetFetch(win, content, base, signal);
  }
  async prepare(path: string, release: string) {
    // 4.3 treats Blob URLs as already extracted files. Keep its HTTP archive
    // name and let the verified fetch boundary serve the compressed bytes.
    const url = release === "4.3.0-pre" ? new URL(path, new URL(this.base, location.href)).href : await this.urls.url(path);
    this.win.EJS_paths = {[fileName(path)]: url};
  }
  close() {this.urls.close(); this.restoreFetch();}
}
