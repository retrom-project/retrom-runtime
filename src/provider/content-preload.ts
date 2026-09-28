import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import type {AssetIndexV1} from "./module-api.js";
import type {SourceContext} from "../content-io/source.js";
import {integer, record} from "../content-io/source.js";
import {verifiedContentAsset} from "../content-io/bootstrap.js";
import {checkSignal} from "../content-io/abort.js";

export type PreloadProgress = (loadedBytes: number, totalBytes: number) => void;

/** Holds the private preparation worker's leases; its Reader consumers use the same persistent namespace. */
export class ProviderContentPreload {
  private worker?: Worker;
  private reject?: (error: Error) => void;
  private closed = false;

  async prepare(sources: ContentSourceV1[], context: SourceContext, runtimeBaseURL: string,
    assetIndex: AssetIndexV1, signal: AbortSignal, report: PreloadProgress): Promise<void> {
    const blob = await verifiedContentAsset(runtimeBaseURL, assetIndex, "worker.mjs", signal);
    checkSignal(signal);
    if (this.closed) {throw new DOMException("Aborted", "AbortError");}
    const url = URL.createObjectURL(blob);
    try {this.worker = new Worker(url, {type: "module", name: "retrom-content-preload"});}
    finally {URL.revokeObjectURL(url);}
    const abort = () => this.close();
    signal.addEventListener("abort", abort, {once: true});
    try {
      await new Promise<void>((resolve, reject) => {
        this.reject = reject;
        const worker = this.worker!;
        worker.onerror = () => reject(new Error("CONTENT_IO_PRELOAD_FAILED"));
        worker.onmessageerror = () => reject(new Error("CONTENT_IO_PRELOAD_FAILED"));
        worker.onmessage = ({data}: MessageEvent<unknown>) => {
          if (!record(data)) {reject(new Error("CONTENT_IO_PRELOAD_FAILED")); return;}
          if (data.type === "COMPLETE") {resolve();}
          else if (data.type === "ERROR") {reject(new Error(typeof data.code === "string" ? data.code : "CONTENT_IO_PRELOAD_FAILED"));}
          else if (data.type === "PROGRESS" && integer(data.loadedBytes) && integer(data.totalBytes) && data.loadedBytes <= data.totalBytes) {
            report(data.loadedBytes, data.totalBytes);
          } else {reject(new Error("CONTENT_IO_PRELOAD_FAILED"));}
        };
        worker.postMessage({type: "PRELOAD", ...context, sources});
      });
      checkSignal(signal);
    } catch (error) {this.close(); throw error;}
    finally {this.reject = undefined; signal.removeEventListener("abort", abort);}
  }

  close(): void {
    this.closed = true;
    this.reject?.(new DOMException("Aborted", "AbortError"));
    this.worker?.terminate();
    this.worker = undefined;
  }
}
