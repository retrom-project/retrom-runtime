import type { RuntimeProgressReporter } from "../internal-adapter.js";
import type { ButterscotchRuntimeConfig } from "./contract.js";

type ProjectFile = { path: string; sizeBytes: number; url: string };
type ProjectIndex = { files: ProjectFile[]; schemaVersion: 1 };
type ProjectConfig = Pick<ButterscotchRuntimeConfig, "contentDigest" | "sessionId"> & {
  adapter: Pick<ButterscotchRuntimeConfig["adapter"], "projectIndexUrl">;
};

const maximumProjectFiles = 10_000;
const progressStepBytes = 1024 * 1024;
const projectStoreDirectory = "projects";

export async function prepareButterscotchProject(
  config: ProjectConfig,
  frameWindow: Window,
  reportProgress: RuntimeProgressReporter,
) {
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: null });
  const index = await loadProjectIndex(config.adapter.projectIndexUrl, frameWindow.document.baseURI);
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 1, totalBytes: 1 });
  const storage = frameWindow.navigator.storage;
  if (typeof storage?.getDirectory !== "function") {throw new Error("BUTTERSCOTCH_RUNTIME_UNAVAILABLE");}
  let root: FileSystemDirectoryHandle;
  try {root = await storage.getDirectory();}
  catch {throw new Error("BUTTERSCOTCH_RUNTIME_UNAVAILABLE");}
  const projects = await directory(root, projectStoreDirectory);
  const project = await directory(projects, config.contentDigest);
  const saves = await directory(await directory(root, "saves"), config.sessionId);
  void saves;
  const totalBytes = index.files.reduce((total, file) => total + file.sizeBytes, 0);
  let loadedBytes = 0;
  let reportedBytes = 0;
  const report = (force = false) => {
    if (force || loadedBytes - reportedBytes >= progressStepBytes) {
      reportProgress({ phase: "PROJECT_CONTENT", loadedBytes, totalBytes });
      reportedBytes = loadedBytes;
    }
  };
  report(true);
  for (const file of index.files) {
    const target = await fileTarget(project, file.path);
    const cached = await exactCachedFile(target.parent, target.name, file.sizeBytes);
    if (!cached) {
      await writeProjectFile(target.parent, target.name, file, frameWindow.document.baseURI, (count) => {
        loadedBytes += count;
        report();
      });
    } else {
      loadedBytes += file.sizeBytes;
      report();
    }
  }
  report(true);
  return {
    gamePath: `/butterscotch/${projectStoreDirectory}/${config.contentDigest}/data.win`,
    savePath: `/butterscotch/saves/${config.sessionId}`,
  };
}

async function loadProjectIndex(url: string, documentBase: string): Promise<ProjectIndex> {
  let value: unknown;
  try {
    const response = await fetch(new URL(url, documentBase), { credentials: "same-origin", redirect: "error" });
    if (!response.ok || response.redirected) {throw new Error("response");}
    value = await response.json();
  } catch {throw new Error("BUTTERSCOTCH_PROJECT_INDEX_UNAVAILABLE");}
  if (!validProjectIndex(value)) {throw new Error("BUTTERSCOTCH_PROJECT_INDEX_INVALID");}
  return value;
}

function validProjectIndex(value: unknown): value is ProjectIndex {
  if (!isRecord(value) || !exactKeys(value, ["files", "schemaVersion"]) || value.schemaVersion !== 1 ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > maximumProjectFiles) {return false;}
  const identities = new Set<string>();
  let totalBytes = 0;
  let dataWinCount = 0;
  for (const file of value.files) {
    if (!isRecord(file) || !exactKeys(file, ["path", "sizeBytes", "url"]) || !validPath(file.path) ||
      !validProjectUrl(file.url) || !Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) < 1) {return false;}
    const identity = file.path.toLowerCase();
    if (identities.has(identity)) {return false;}
    identities.add(identity);
    totalBytes += Number(file.sizeBytes);
    if (!Number.isSafeInteger(totalBytes)) {return false;}
    if (identity === "data.win") {dataWinCount += 1;}
  }
  return dataWinCount === 1;
}

async function fileTarget(root: FileSystemDirectoryHandle, path: string) {
  const parts = path.split("/");
  const name = parts.pop();
  if (!name) {throw new Error("BUTTERSCOTCH_PROJECT_INDEX_INVALID");}
  let parent = root;
  for (const part of parts) {parent = await directory(parent, part);}
  return { name, parent };
}

async function directory(parent: FileSystemDirectoryHandle, name: string) {
  try {return await parent.getDirectoryHandle(name, { create: true });}
  catch {throw new Error("BUTTERSCOTCH_PROJECT_STORE_FAILED");}
}

async function exactCachedFile(parent: FileSystemDirectoryHandle, name: string, sizeBytes: number) {
  try {
    const handle = await parent.getFileHandle(name);
    if ((await handle.getFile()).size === sizeBytes) {return true;}
    await parent.removeEntry(name);
  } catch {return false;}
  return false;
}

async function writeProjectFile(
  parent: FileSystemDirectoryHandle,
  name: string,
  file: ProjectFile,
  documentBase: string,
  reportChunk: (size: number) => void,
) {
  const response = await fetch(new URL(file.url, documentBase), {
    cache: "default", credentials: "same-origin", redirect: "error",
  });
  if (!response.ok || response.redirected) {throw new Error("BUTTERSCOTCH_PROJECT_FILE_UNAVAILABLE");}
  const handle = await parent.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let written = 0;
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writable.write(bytes);
      written = bytes.byteLength;
      reportChunk(written);
    } else {
      while (true) {
        const result = await reader.read();
        if (result.done) {break;}
        if (written + result.value.byteLength > file.sizeBytes) {throw new Error("size");}
        await writable.write(result.value);
        written += result.value.byteLength;
        reportChunk(result.value.byteLength);
      }
      reader.releaseLock();
    }
    if (written !== file.sizeBytes) {throw new Error("size");}
    await writable.close();
  } catch {
    await writable.abort().catch(() => undefined);
    await parent.removeEntry(name).catch(() => undefined);
    throw new Error("BUTTERSCOTCH_PROJECT_FILE_INVALID");
  }
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.normalize("NFC") === value &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("//") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function validProjectUrl(value: unknown) {
  if (typeof value !== "string") {return false;}
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes("#")) {return true;}
  try {return ["http:", "https:"].includes(new URL(value).protocol);} catch {return false;}
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}
