import type {RuntimeResourceV1, RuntimeStartupKindV1} from "../../provider/module-api.js";
import type {StartupTasks} from "../../provider/startup.js";
import type {EjsInstance} from "./emulator-instance.js";
import {startupDownloadProgress, type StartupDownloadTransport} from "./startup-download-progress.js";

type Loader = (...args: unknown[]) => Promise<unknown>;
type Downloads = StartupDownloadTransport & {config?: {gameUrl?: unknown; biosUrl?: unknown; gameParentUrl?: unknown; dataPath?: string; filePaths?: Record<string, string>};
  downloadFile?: Loader; downloadRom?: Loader; downloadBios?: Loader; downloadGameParent?: Loader; startGame?: Loader};

/** One bridge per EmulatorJS release covers every core; never parse its status DOM. */
export function installStartupDownloads(instance: EjsInstance, release: string, tasks: StartupTasks, xhrClass?: typeof XMLHttpRequest,
  resources: readonly RuntimeResourceV1[] = []): () => void {
  const downloads = instance as unknown as Downloads;
  const progress = startupDownloadProgress(downloads, release, xhrClass);
  const kinds = resourceKinds(resources);
  const cleanups: Array<() => void> = [];
  const wrap = (name: Exclude<keyof Downloads, "config" | "downloader">, kind: RuntimeStartupKindV1 | ((args: unknown[]) => RuntimeStartupKindV1), summary = false) => {
    const original = downloads[name];
    if (!original) {return;}
    const observed: Loader = async (...args) => {
      const url = name === "downloadFile" ? downloadURL(downloads, release, args) : "";
      const task = tasks.begin(kinds.get(url) ?? (typeof kind === "function" ? kind(args) : kind), {summary});
      const unwatch = name === "downloadFile" ? progress.watch(url, task) : () => {};
      try {
        const result = await original.apply(instance, args);
        // Both pinned releases resolve -1 for download errors; keep their error handling intact.
        if (result === -1) {task.fail();} else {task.complete();}
        return result;
      } catch (error) {task.fail(); throw error;}
      finally {unwatch();}
    };
    downloads[name] = observed;
    cleanups.push(() => {if (downloads[name] === observed) {downloads[name] = original;}});
  };
  if (release === "4.2.3") {
    wrap("downloadRom", "GAME_CONTENT", true);
    if (downloads.config?.biosUrl) {wrap("downloadBios", "BIOS", true);}
    if (downloads.config?.gameParentUrl) {wrap("downloadGameParent", "DEPENDENCIES", true);}
    wrap("downloadFile", args => legacyDownloadKind(downloads, args[0]));
  } else {
    wrap("downloadFile", args => downloadKind(args[1]));
  }
  wrap("startGame", "CORE_INITIALIZATION", true);
  return () => {progress.stop(); for (const cleanup of cleanups.reverse()) {cleanup();}};
}

function resourceKinds(resources: readonly RuntimeResourceV1[]) {
  const kinds = new Map<string, RuntimeStartupKindV1>();
  for (const resource of resources) {
    if (resource.kind === "BIOS_BUNDLE" || resource.kind === "EXTERNAL_FILE_SET") {
      for (const file of resource.files) {kinds.set(file.url, resource.kind === "BIOS_BUNDLE" ? "BIOS" : "DEPENDENCIES");}
    } else if ("url" in resource) {kinds.set(resource.url, resource.kind === "PARENT_ARCHIVE" ? "DEPENDENCIES" : "GAME_CONTENT");}
  }
  return kinds;
}

function downloadURL(downloads: Downloads, release: string, args: unknown[]): string {
  if (typeof args[0] !== "string") {return "";}
  const external = args[release === "4.2.3" ? 2 : 3];
  const path = (external ? "" : downloads.config?.dataPath ?? "") + args[0];
  return !external && downloads.config?.filePaths?.[path.split("/").pop()!] || path;
}

function downloadKind(type: unknown): RuntimeStartupKindV1 {
  if (type === "rom") {return "GAME_CONTENT";}
  if (type === "bios") {return "BIOS";}
  if (type === "parent" || type === "patch" || type === "external") {return "DEPENDENCIES";}
  if (type === "states") {return "RESTORE_LOAD";}
  return "CORE_ASSETS";
}

function legacyDownloadKind(downloads: Downloads, path: unknown): RuntimeStartupKindV1 {
  if (path && path === downloads.config?.gameUrl) {return "GAME_CONTENT";}
  if (path && path === downloads.config?.biosUrl) {return "BIOS";}
  if (path && path === downloads.config?.gameParentUrl) {return "DEPENDENCIES";}
  return "CORE_ASSETS";
}
