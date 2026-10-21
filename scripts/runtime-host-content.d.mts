import type {Readable} from "node:stream";
export type HostContentLocator = {path: string; offset: number; sizeBytes: number};
export function openContent(locator: HostContentLocator): Promise<{
 stat(): Promise<{size: number; isFile(): boolean; isSymbolicLink(): boolean}>;
 read(buffer: Buffer, offset: number, length: number, position: number): Promise<{bytesRead: number; buffer: Buffer}>;
 close(): Promise<void>;
}>;
export function readContent(locator: HostContentLocator): Promise<Buffer>;
export function contentStream(locator: HostContentLocator, options?: {start?: number; length?: number; signal?: AbortSignal}): Readable;
