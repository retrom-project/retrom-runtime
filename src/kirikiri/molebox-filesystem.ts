import {md5} from "@noble/hashes/legacy.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";

type Stat = {size: number; isDir: boolean};
type Item = Stat & {name: string};
export type MoleboxFilesystem = {
  has(path: string): number;
  stat(path: string): Stat | null;
  resolveCase(path: string): string | null;
  listdir(path: string): Item[] | null;
  open(path: string, mode: number): number;
  unlink(path: string): number;
  mkdir(path: string): number;
};
type File = {path: string; reader: Pick<ContentReaderV1, "sizeBytes" | "readInto">};
type Domain = {root: string; privateRoot: string; entries: Map<string, string>; directories: string[]};
const maximumMetadataBytes = 32 * 1024 * 1024;
const marker = /(?:^|\/)\.retrom-molebox\/[a-f0-9]{64}\/index\.json$/u;
const fold = (value: string) => value.replace(/[a-z]/gu, char => char.toUpperCase());
function invalid(): never {throw new Error("KIRIKIRI_MOLEBOX_INDEX_INVALID");}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// The supplied loader's C-locale towupper is per UTF-16 unit, with no Unicode
// expansions. Hashes are native lookup keys, never a game selection rule.
export function moleboxNameHash(name: string): string {
  name = fold(name.replaceAll("/", "\\"));
  const bytes = new Uint8Array(name.length * 2);
  for (let i = 0; i < name.length; i++) {const unit = name.charCodeAt(i); bytes[i * 2] = unit; bytes[i * 2 + 1] = unit >>> 8;}
  return Array.from(md5(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function logicalPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {if (!parts.length) return null; parts.pop();}
    else {if (part.includes("\0")) return null; parts.push(part);}
  }
  return parts.join("/");
}
function sourceRoot(value: unknown): string {
  if (typeof value !== "string" || !value || logicalPath(value) !== value || !/\.exe$/iu.test(value)) invalid();
  return value.slice(0, value.lastIndexOf("/") + 1);
}
function requireIndex(value: unknown): Record<string, unknown> & {entries: unknown[]; directories: unknown[]} {
  if (!object(value) || value.kind !== "molebox4-steelbox" || !Array.isArray(value.entries) ||
    !Array.isArray(value.directories) || value.directories.length > 100000 || !value.entries.length || value.entries.length > 100000) invalid();
  return value as Record<string, unknown> & {entries: unknown[]; directories: unknown[]};
}
function parseEntry(value: unknown, root: string, descriptor: string, paths: Set<string>): [string, string] {
  if (!object(value) || typeof value.hash !== "string" || !/^[a-f0-9]{32}$/u.test(value.hash) ||
    typeof value.path !== "string" || logicalPath(value.path) !== value.path || !value.path.startsWith(root) || !paths.has(value.path)) invalid();
  if (typeof value.flags !== "number" || !Number.isInteger(value.flags) || value.flags < 0 || value.flags > 0x17 ||
    (value.flags & ~0x17) !== 0) invalid();
  if ((value.flags & 1) && !value.path.startsWith(descriptor.slice(0, -"index.json".length))) invalid();
  return [value.hash, value.path];
}
function parseDomain(input: unknown, descriptor: string, paths: Set<string>): Domain {
  const value = requireIndex(input);
  const root = sourceRoot(value.source), privateRoot = root + ".retrom-molebox/";
  if (typeof value.source !== "string" || !paths.has(value.source) || !descriptor.startsWith(privateRoot)) invalid();
  const entries = new Map<string, string>();
  for (const row of value.entries) {
    const [hash, path] = parseEntry(row, root, descriptor, paths);
    if (entries.has(hash)) invalid();
    entries.set(hash, path);
  }
  const directories: string[] = [];
  for (const path of value.directories) {
    if (typeof path !== "string" || !path || logicalPath(path) !== path || path.startsWith(".retrom-molebox/")) invalid();
    directories.push(root + path);
  }
  return {root, privateRoot, entries, directories};
}
function requireFilesystem(value: unknown): MoleboxFilesystem {
  if (!object(value) || ["has", "stat", "resolveCase", "listdir", "open", "unlink", "mkdir"]
    .some(name => typeof value[name] !== "function")) throw new Error("KIRIKIRI_MOLEBOX_FILESYSTEM_UNAVAILABLE");
  return value as MoleboxFilesystem;
}
async function readDomain(file: File, paths: Set<string>, signal?: AbortSignal): Promise<Domain> {
  if (!Number.isSafeInteger(file.reader.sizeBytes) || file.reader.sizeBytes <= 0 || file.reader.sizeBytes > maximumMetadataBytes) invalid();
  const bytes = new Uint8Array(file.reader.sizeBytes);
  if (await file.reader.readInto(0, bytes, signal) !== bytes.length) invalid();
  signal?.throwIfAborted();
  let value: unknown;
  try {value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));} catch {invalid();}
  return parseDomain(value, file.path, paths);
}
function installDomains(fs: MoleboxFilesystem, domains: Domain[]) {
  const original = {has: fs.has.bind(fs), stat: fs.stat.bind(fs), resolveCase: fs.resolveCase.bind(fs),
    listdir: fs.listdir.bind(fs), open: fs.open.bind(fs), unlink: fs.unlink.bind(fs)};
  const privatePath = (path: string) => domains.some(domain => fold(path + "/").startsWith(fold(domain.privateRoot)));
  const resolve = (path: string) => {
    const domain = domains.find(item => fold(path).startsWith(fold(item.root)));
    return domain?.entries.get(moleboxNameHash(path.slice(domain.root.length))) ?? null;
  };
  const mapped = (name: string, originalPath: string) => {const backing = resolve(name); return backing ? "/" + backing : originalPath;};
  fs.has = path => {const name = logicalPath(path); return name === null || privatePath(name) ? 0 : original.has(mapped(name, path));};
  fs.stat = path => {const name = logicalPath(path); return name === null || privatePath(name) ? null : original.stat(mapped(name, path));};
  // Keep the queried logical spelling. Returning an opaque backing path would
  // leak it into Kiri's placed-path cache and break subsequent file opens.
  fs.resolveCase = path => {
    const name = logicalPath(path);
    return name === null || privatePath(name) ? null : resolve(name) ? "/" + name : original.resolveCase(path);
  };
  fs.open = (path, mode) => {
    const name = logicalPath(path);
    if (name === null || privatePath(name)) return -1;
    const backing = resolve(name);
    return backing ? mode === 0 ? original.open("/" + backing, mode) : -1 : original.open(path, mode);
  };
  fs.unlink = path => {
    const name = logicalPath(path);
    return name === null || privatePath(name) || resolve(name) ? -1 : original.unlink(path);
  };
  fs.listdir = path => {
    const name = logicalPath(path);
    if (name === null || privatePath(name)) return null;
    return original.listdir(path)?.filter(item => !privatePath((name ? name + "/" : "") + item.name)) ?? null;
  };
  for (const domain of domains) for (const path of domain.directories) fs.mkdir("/" + path);
}
/** Install the immutable namespace before the VM starts, after all public
 * Content Readers have been registered. Nothing is renamed or eagerly decoded
 * in the browser; ordinary range caching remains owned by Content IO. */
export async function installMoleboxFilesystem(filesystem: unknown, files: File[], signal?: AbortSignal): Promise<void> {
  const descriptors = files.filter(file => marker.test(file.path));
  if (!descriptors.length) return;
  if (descriptors.reduce((sum, file) => sum + file.reader.sizeBytes, 0) > maximumMetadataBytes) invalid();
  const fs = requireFilesystem(filesystem), paths = new Set(files.map(file => file.path)), domains: Domain[] = [];
  for (const descriptor of descriptors) {
    signal?.throwIfAborted();
    const domain = await readDomain(descriptor, paths, signal);
    if (domains.some(previous => fold(previous.root) === fold(domain.root))) throw new Error("KIRIKIRI_MOLEBOX_NAMESPACE_CONFLICT");
    domains.push(domain);
  }
  domains.sort((a, b) => b.root.length - a.root.length);
  installDomains(fs, domains);
}
