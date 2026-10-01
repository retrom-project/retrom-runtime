import type {StartupTask} from "../../provider/startup.js";

type Download = (...args: unknown[]) => Promise<unknown>;
export type StartupDownloadTransport = {downloader?: {downloadFile?: Download}};

/** Observe byte counters at the pinned transport APIs, without parsing status text. */
export function startupDownloadProgress(instance: StartupDownloadTransport, release: string,
  xhrClass?: typeof XMLHttpRequest) {
  const pending = new Map<string, StartupTask>();
  const cleanups: Array<() => void> = [];
  if (release === "4.2.3" && xhrClass) {
    const prototype = xhrClass.prototype, original = prototype.open;
    const observed: typeof original = function(this: XMLHttpRequest, method: string, url: string | URL,
      async: boolean = true, username?: string | null, password?: string | null) {
      const task = pending.get(String(url));
      if (task) {this.addEventListener("progress", event => {
        task.progress(event.loaded, event.lengthComputable ? event.total : null);
      });}
      original.call(this, method, url, async, username ?? null, password ?? null);
    };
    prototype.open = observed;
    cleanups.push(() => {if (prototype.open === observed) {prototype.open = original;}});
  }
  const downloader = instance.downloader, original = downloader?.downloadFile;
  if (release !== "4.2.3" && downloader && original) {
    const observed: Download = (...args) => {
      const task = pending.get(String(args[0])), progress = args[5];
      if (task) {args[5] = (...values: unknown[]) => {
        if (values[0] === "downloading" && typeof values[2] === "number" && typeof values[3] === "number") {
          task.progress(values[2], values[3] > 0 ? values[3] : null);
        }
        if (typeof progress === "function") {progress(...values);}
      };}
      return original.apply(downloader, args);
    };
    downloader.downloadFile = observed;
    cleanups.push(() => {if (downloader.downloadFile === observed) {downloader.downloadFile = original;}});
  }
  return {
    watch: (url: string, task: StartupTask) => {
      pending.set(url, task);
      return () => {if (pending.get(url) === task) {pending.delete(url);}};
    },
    stop: () => {pending.clear(); for (const cleanup of cleanups) {cleanup();}},
  };
}
