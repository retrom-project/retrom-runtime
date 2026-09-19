import {readExact} from "../bounded-stream.js";
import {fail} from "../errors.js";
import {BLOCK_BYTES, integer, isDigest} from "../source.js";
import {namespace, type BlockReceipt, type DataStore} from "./types.js";
export type SyncAccess = {read: (bytes: Uint8Array<ArrayBuffer>, options: {at: number}) => number;
  write: (bytes: Uint8Array<ArrayBuffer>, options: {at: number}) => number; flush: () => void; close: () => void};
type SyncFile = FileSystemFileHandle & {createSyncAccessHandle(): Promise<SyncAccess>};
export function validLocation(key: string, generation: string): void {
  if (!isDigest(key) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(generation)) {fail("CACHE_UNAVAILABLE");}
}
export class OPFSStore implements DataStore {
  readonly backend = "OPFS" as const;
  constructor(private readonly root: FileSystemDirectoryHandle) {}
  static async open(): Promise<OPFSStore> {
    const root = await navigator.storage.getDirectory();
    return new OPFSStore(await root.getDirectoryHandle(namespace, {create: true}));
  }
  location(key: string, generation: string): string {validLocation(key, generation); return `objects/${key}/${generation}.data`;}
  async read(receipt: BlockReceipt, complete: boolean): Promise<Uint8Array<ArrayBuffer>> {
    const file = await this.handle(receipt.objectKey, receipt.generation, false);
    const start = receipt.index * BLOCK_BYTES;
    if (complete) {return readExact((await file.getFile()).slice(start, start + receipt.length).stream(), receipt.length);}
    const handle = await file.createSyncAccessHandle();
    try {
      const bytes = new Uint8Array(receipt.length); syncRead(handle, bytes, start); return bytes;
    } finally {handle.close();}
  }
  async write(receipt: BlockReceipt, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const file = await this.handle(receipt.objectKey, receipt.generation, true), handle = await file.createSyncAccessHandle();
    try {syncWrite(handle, bytes, receipt.index * BLOCK_BYTES); handle.flush();} finally {handle.close();}
  }
  async file(key: string, generation: string): Promise<File> {return (await this.handle(key, generation, false)).getFile();}
  async remove(key: string, _generations: readonly string[]): Promise<void> {
    if (!isDigest(key)) {fail("CACHE_UNAVAILABLE");}
    const objects = await this.root.getDirectoryHandle("objects", {create: true});
    try {await objects.removeEntry(key, {recursive: true});} catch (error) {if (!(error instanceof DOMException) || error.name !== "NotFoundError") {throw error;}}
  }
  async probe(): Promise<void> {
    const name = `probe-${crypto.randomUUID()}`;
    let handle: SyncAccess | undefined;
    try {
      const file = await this.root.getFileHandle(name, {create: true}) as SyncFile;
      handle = await file.createSyncAccessHandle(); const bytes = new Uint8Array([31, 71, 199]);
      syncWrite(handle, bytes, 0); handle.flush(); const read = new Uint8Array(3); syncRead(handle, read, 0);
      if (!read.every((value, index) => value === bytes[index])) {fail("CACHE_UNAVAILABLE");}
    } finally {handle?.close(); await this.root.removeEntry(name).catch(() => {});}
  }
  private async handle(key: string, generation: string, create: boolean): Promise<SyncFile> {
    validLocation(key, generation);
    const objects = await this.root.getDirectoryHandle("objects", {create});
    const directory = await objects.getDirectoryHandle(key, {create});
    return directory.getFileHandle(`${generation}.data`, {create}) as Promise<SyncFile>;
  }
}
export function syncRead(handle: SyncAccess, bytes: Uint8Array<ArrayBuffer>, start: number): void {
  for (let offset = 0; offset < bytes.length;) {
    const count = handle.read(bytes.subarray(offset), {at: start + offset});
    if (!integer(count, 1, bytes.length - offset)) {fail("CACHE_UNAVAILABLE");} offset += count;
  }
}
export function syncWrite(handle: SyncAccess, bytes: Uint8Array<ArrayBuffer>, start: number): void {
  for (let offset = 0; offset < bytes.length;) {
    const count = handle.write(bytes.subarray(offset), {at: start + offset});
    if (!integer(count, 1, bytes.length - offset)) {fail("CACHE_UNAVAILABLE");} offset += count;
  }
}
