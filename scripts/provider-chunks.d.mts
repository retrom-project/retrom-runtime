export type ProviderChunkFile = {path: string; sha256: string; sizeBytes: number};
export type ProviderChunkPlan = {chunkId: string; files: ProviderChunkFile[]; unpackedSizeBytes: number};
export type ProviderChunk = ProviderChunkPlan & {archive: string; archiveSha256: string; archiveSizeBytes: number};
export type ProviderChunkManifest = {
  schemaVersion: 1;
  providerId: string;
  providerVersion: string;
  bundleSha256: string;
  chunks: ProviderChunk[];
};
export type ProviderChunkPublication = {
  manifestPath: string;
  manifestSha256: string;
  manifestSizeBytes: number;
  chunkCount: number;
  bundleSha256: string;
};

export const CHUNK_LIMIT_BYTES: number;
export function chunkGroup(path: string): string;
export function planProviderChunks(files: ProviderChunkFile[]): ProviderChunkPlan[];
export function chunkProviderBundle(input: {
  bundleRoot: string; providerId: string; providerVersion: string; outputRoot: string;
}): Promise<ProviderChunkPublication>;
export function verifyProviderChunks(input: {bundleRoot: string; manifestPath: string; chunkRoot: string}): Promise<{
  chunkCount: number; fileCount: number; bundleSha256: string;
}>;
