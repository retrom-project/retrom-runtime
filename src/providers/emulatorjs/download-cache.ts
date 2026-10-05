import type {EjsWindow} from "./emulator-instance.js";

const downloadDatabases = new Set(["EmulatorJS-Cache", "EmulatorJS-roms", "EmulatorJS-bios", "EmulatorJS-core"]);

export function disableEmulatorDownloadCache(target: EjsWindow, release: "4.2.3" | "4.3.0-pre") {
  if (release === "4.2.3") {target.EJS_disableDatabases = true;}
  else {target.EJS_cacheConfig = {enabled: false};}
}

// This Provider owns only these download databases. Native saves, states and
// Content I/O records have separate owners and are never part of this cleanup.
export async function retireEmulatorDownloadCaches(factory: IDBFactory | undefined, report: (code: string) => void) {
  if (!factory?.databases) {return;}
  try {
    const databases = await factory.databases();
    const outcomes = await Promise.all(databases.flatMap(({name}) =>
      name && downloadDatabases.has(name) ? [removeDatabase(factory, name)] : []));
    if (outcomes.some(removed => !removed)) {report("EJS_DOWNLOAD_CACHE_RETIRE_INCOMPLETE");}
  } catch {report("EJS_DOWNLOAD_CACHE_RETIRE_FAILED");}
}

function removeDatabase(factory: IDBFactory, name: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = factory.deleteDatabase(name);
    const timer = setTimeout(() => finish(false), 500);
    const success = () => finish(true);
    const failure = () => finish(false);
    function finish(removed: boolean) {
      clearTimeout(timer);
      request.removeEventListener("success", success);
      request.removeEventListener("error", failure);
      request.removeEventListener("blocked", failure);
      resolve(removed);
    }
    request.addEventListener("success", success, {once: true});
    request.addEventListener("error", failure, {once: true});
    request.addEventListener("blocked", failure, {once: true});
  });
}
