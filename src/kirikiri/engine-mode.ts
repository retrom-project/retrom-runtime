import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";

export type KirikiriEngineMode = "AUTO" | "KIRIKIRI2" | "KIRIKIRI_Z";
type NativeMode = Exclude<KirikiriEngineMode, "AUTO">;
type File = {path: string; reader: Pick<ContentReaderV1, "sizeBytes" | "readInto">};
const maximumExecutables = 16, maximumResourceBytes = 1024 * 1024;
const align = (value: number) => Math.ceil(value / 4) * 4;
function requireValid(value: unknown): asserts value {if (!value) {throw new Error("KIRIKIRI_ENGINE_METADATA_INVALID");}}
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const text = (bytes: Uint8Array) => new TextDecoder("utf-16le", {fatal: true}).decode(bytes);

// Read PE metadata as data through the same bounded Content I/O readers as the
// filesystem. Executables are never loaded, and names do not identify an engine.
async function executableModes(file: File, signal?: AbortSignal): Promise<Set<NativeMode>> {
  const read = async (offset: number, length: number) => {
    signal?.throwIfAborted();
    requireValid(offset >= 0 && length > 0 && offset + length <= file.reader.sizeBytes);
    const bytes = new Uint8Array(length);
    requireValid(await file.reader.readInto(offset, bytes, signal) === length);
    signal?.throwIfAborted(); return bytes;
  };
  const modes = new Set<NativeMode>();
  if (file.reader.sizeBytes < 64) {return modes;}
  const dos = view(await read(0, 64));
  if (dos.getUint16(0, true) !== 0x5a4d) {return modes;}
  const peAt = dos.getUint32(60, true);
  requireValid(peAt >= 64 && peAt <= 1024 * 1024);
  const pe = view(await read(peAt, 24)), count = pe.getUint16(6, true), optional = pe.getUint16(20, true);
  requireValid(pe.getUint32(0, true) === 0x4550 && count > 0 && count <= 96 && optional >= 120 && optional <= 512);
  const header = view(await read(peAt + 24, optional + count * 40)), magic = header.getUint16(0, true);
  requireValid(magic === 0x10b || magic === 0x20b);
  const directories = magic === 0x10b ? 96 : 112;
  requireValid(optional >= directories + 24);
  if (header.getUint32(directories - 4, true) < 3) {return modes;}
  const rva = header.getUint32(directories + 16, true), length = header.getUint32(directories + 20, true);
  if (!rva || !length) {return modes;}
  requireValid(length <= maximumResourceBytes);
  const matches: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = optional + i * 40, address = header.getUint32(at + 12, true);
    const size = header.getUint32(at + 16, true), offset = header.getUint32(at + 20, true);
    if (rva >= address && rva - address + length <= size) {
      requireValid(offset >= peAt + 24 + header.byteLength && offset + size <= file.reader.sizeBytes);
      matches.push(offset + rva - address);
    }
  }
  requireValid(matches.length === 1);
  const bytes = await read(matches[0]!, length), resource = view(bytes), visited = new Set<number>();
  let entries = 0;
  function directory(offset: number, depth: number) {
    requireValid(depth <= 2 && !visited.has(offset) && offset + 16 <= bytes.length);
    visited.add(offset);
    const count = resource.getUint16(offset + 12, true) + resource.getUint16(offset + 14, true);
    entries += count; requireValid(entries <= 256 && offset + 16 + count * 8 <= bytes.length);
    for (let i = 0; i < count; i++) {
      const at = offset + 16 + i * 8, id = resource.getUint32(at, true), next = resource.getUint32(at + 4, true);
      if (depth === 0 && id !== 16) {continue;} // RT_VERSION only.
      if (next & 0x80000000) {directory(next & 0x7fffffff, depth + 1);}
      else {
        requireValid(depth === 2 && next + 16 <= bytes.length);
        const data = resource.getUint32(next, true) - rva, size = resource.getUint32(next + 4, true);
        requireValid(data >= 0 && size > 0 && size <= 65535 && data + size <= bytes.length);
        for (const mode of versionModes(bytes.subarray(data, data + size))) {modes.add(mode);}
      }
    }
  }
  directory(0, 0); return modes;
}

// VERSIONINFO's typed, length-delimited tree prevents script strings or an
// unrelated PE section containing an engine name from becoming mode evidence.
function versionModes(bytes: Uint8Array): Set<NativeMode> {
  const data = view(bytes), modes = new Set<NativeMode>(); let blocks = 0;
  function node(at: number, limit: number) {
    requireValid(++blocks <= 4096 && at + 6 <= limit);
    const end = at + data.getUint16(at, true), units = data.getUint16(at + 2, true), type = data.getUint16(at + 4, true);
    requireValid(end > at + 6 && end <= limit && type <= 1);
    let p = at + 6;
    while (p + 2 <= end && data.getUint16(p, true) !== 0) {p += 2;}
    requireValid(p + 2 <= end);
    const key = text(bytes.subarray(at + 6, p)), start = align(p + 2), size = units * (type === 1 ? 2 : 1);
    requireValid(start + size <= end);
    return {key, type, start, size, child: align(start + size), end};
  }
  type Node = ReturnType<typeof node>;
  function children(parent: Node) {
    const result: Node[] = [];
    for (let at = parent.child; at < parent.end;) {const child = node(at, parent.end); result.push(child); at = align(child.end);}
    return result;
  }
  const root = node(0, bytes.length);
  requireValid(root.key === "VS_VERSION_INFO" && root.type === 0 && root.size === 52 && data.getUint32(root.start, true) === 0xfeef04bd);
  for (const info of children(root).filter(item => item.key === "StringFileInfo")) {
    requireValid(info.size === 0);
    for (const table of children(info)) {
      requireValid(/^[a-f\d]{8}$/iu.test(table.key) && table.size === 0);
      for (const item of children(table)) {
        if (item.key !== "ProductName" && item.key !== "FileDescription") {continue;}
        requireValid(item.type === 1 && item.size >= 2 && data.getUint16(item.start + item.size - 2, true) === 0);
        const value = text(bytes.subarray(item.start, item.start + item.size - 2)).trim();
        const match = /^TVP\(KIRIKIRI\)\s+(Z|2)\s+core(?:\s*\/[^\0]*)?$/iu.exec(value);
        if (match) {modes.add(match[1]!.toUpperCase() === "Z" ? "KIRIKIRI_Z" : "KIRIKIRI2");}
      }
    }
  }
  return modes;
}

export async function resolveKirikiriEngineMode(mode: KirikiriEngineMode, files: readonly File[], signal?: AbortSignal): Promise<NativeMode> {
  signal?.throwIfAborted();
  if (mode !== "AUTO") {return mode;}
  // Project indices already strip the selected project root. Sibling projects,
  // installers and tools in subdirectories must not influence this selection.
  const executables = files.filter(file => !file.path.includes("/") && /\.exe$/iu.test(file.path));
  if (!executables.length || executables.length > maximumExecutables) {return "KIRIKIRI2";}
  const modes = new Set<NativeMode>();
  try {
    for (const file of executables) {for (const found of await executableModes(file, signal)) {modes.add(found);}}
  } catch {
    signal?.throwIfAborted(); return "KIRIKIRI2";
  }
  return modes.size === 1 ? [...modes][0]! : "KIRIKIRI2";
}
