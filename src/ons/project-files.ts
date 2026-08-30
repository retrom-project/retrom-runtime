import type { RuntimeProgressReporter } from "../internal-adapter.js";
import { openOnsProjectStore, type OnsProjectStore } from "./project-store.js";

export type OnsProjectFile = { path: string; sizeBytes: number; url: string };
export type OnsProjectFileNode = OnsProjectFile & {
  loaded: boolean;
  loading?: Promise<void>;
};

type OnsFileSystemWriter = {
  writeFile(path: string, bytes: Uint8Array): void;
};

type ProjectLoadScheduler = <T>(load: () => Promise<T>) => Promise<T>;

const gameRoot = "/game";
const progressStepBytes = 1024 * 1024;

export function createOnsProjectFileMap(
  files: OnsProjectFile[],
  frameWindow: Window,
  reportProgress: RuntimeProgressReporter,
) {
  const map: Record<string, OnsProjectFileNode> = {};
  const progress = projectProgress(files, reportProgress);
  const store = openOnsProjectStore(frameWindow);
  for (const file of files) {
    const path = `${gameRoot}/${file.path}`;
    map[path.toLowerCase()] = { ...file, path, loaded: false };
  }
  return {
    fetchFile: createFileFetcher(map, frameWindow, progress, store, serialProjectLoader()),
    fileMap: map,
  };
}

function createFileFetcher(
  fileMap: Record<string, OnsProjectFileNode>,
  frameWindow: Window,
  progress: ReturnType<typeof projectProgress>,
  store: Promise<OnsProjectStore | null>,
  schedule: ProjectLoadScheduler,
) {
  return async (fileSystem: OnsFileSystemWriter, key: string) => {
    const node = fileMap[key.toLowerCase()];
    if (!node) {return 0;}
    if (node.loaded) {return 1;}
    node.loading ??= schedule(() => loadProjectFile(node, frameWindow, store, (loadedBytes) => {
      progress.update(node.path, loadedBytes);
    })).then((bytes) => {
      fileSystem.writeFile(node.path, bytes);
      node.loaded = true;
    }).catch((error: unknown) => {
      node.loading = undefined;
      throw error;
    });
    try {await node.loading; return 1;} catch {return -1;}
  };
}

function serialProjectLoader(): ProjectLoadScheduler {
  let tail = Promise.resolve();
  return <T>(load: () => Promise<T>) => {
    const scheduled = tail.then(load, load);
    tail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  };
}

function projectProgress(files: OnsProjectFile[], reportProgress: RuntimeProgressReporter) {
  const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  const loadedByPath = new Map<string, number>();
  let loadedBytes = 0;
  let reportedBytes = 0;
  const report = () => reportProgress({ phase: "PROJECT_CONTENT", loadedBytes, totalBytes });
  report();
  return {
    update(path: string, nextBytes: number) {
      const previous = loadedByPath.get(path) ?? 0;
      loadedByPath.set(path, nextBytes);
      loadedBytes += nextBytes - previous;
      if (loadedBytes === totalBytes || Math.abs(loadedBytes - reportedBytes) >= progressStepBytes) {
        report();
        reportedBytes = loadedBytes;
      }
    },
  };
}

async function loadProjectFile(
  node: OnsProjectFileNode,
  frameWindow: Window,
  storePromise: Promise<OnsProjectStore | null>,
  reportLoaded: (loadedBytes: number) => void,
) {
  const url = new URL(node.url, frameWindow.document.baseURI).href;
  const store = await storePromise;
  const cached = await matchStoredResponse(store, url);
  if (cached) {
    try {return await readExactBytes(cached, node.sizeBytes, reportLoaded);}
    catch {
      reportLoaded(0);
      await deleteStoredResponse(store, url);
    }
  }
  const response = await fetch(url, { cache: "default", credentials: "same-origin", redirect: "error" });
  if (!response.ok || response.redirected) {throw new Error("ONS_PROJECT_FILE_UNAVAILABLE");}
  try {
    const bytes = await readExactBytes(response, node.sizeBytes, reportLoaded);
    await putStoredResponse(store, url, bytes);
    return bytes;
  } catch {
    await deleteStoredResponse(store, url);
    throw new Error("ONS_PROJECT_FILE_INVALID");
  }
}

async function readExactBytes(
  response: Response,
  expectedBytes: number,
  reportLoaded: (loadedBytes: number) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedBytes) {throw new Error("size");}
    reportLoaded(bytes.byteLength);
    return bytes;
  }
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {break;}
      if (offset + result.value.byteLength > expectedBytes) {throw new Error("size");}
      bytes.set(result.value, offset);
      offset += result.value.byteLength;
      reportLoaded(offset);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedBytes) {throw new Error("size");}
  return bytes;
}

async function matchStoredResponse(store: OnsProjectStore | null, url: string) {
  try {return await store?.match(url) ?? null;} catch {return null;}
}

async function putStoredResponse(store: OnsProjectStore | null, url: string, bytes: Uint8Array) {
  try {await store?.put(url, bytes);} catch {return;}
}

async function deleteStoredResponse(store: OnsProjectStore | null, url: string) {
  try {await store?.delete(url);} catch {return;}
}
