import type {RuntimeContentFile} from "../src/runtime/types.js";
export interface NormalizationDetail {
  code: string; file: string; member: string;
  sourceSha256?: string; outputSha256?: string; sourceSize?: number; outputSize?: number;
  seed?: number; sourceChecksum?: number; outputChecksum?: number;
}
export interface NormalizationSummary {
  kind: string; converterVersion: number; sourceContentHash: string;
  archiveCount: number; verifiedEntries: number; metadataCorrections: number; omittedPhysicalEntries: number;
  formatCounts: Record<string, number>; warnings: Array<{code: string; count: number}>; details: NormalizationDetail[];
  plugins: Array<{
    id: string; version: number; formats: string[];
    sources: Array<{file: string; sizeBytes: number; sha256: string}>;
    outputs: Array<{file: string; sizeBytes: number; sha256: string}>;
    validation: {outputFilesVerified: number; resourceEntriesVerified: number; metadataCorrections: number; omittedPhysicalEntries: number};
  }>;
}
export function normalizeContent(input: {platformId: string; files: RuntimeContentFile[]; locators?: Record<string, import("./runtime-host-content.mjs").HostContentLocator>; outputRoot?: string}, signal?: AbortSignal): Promise<{files: Array<RuntimeContentFile & {path?: string}>; normalization?: NormalizationSummary}>;
