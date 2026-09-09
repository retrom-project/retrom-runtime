export type EmulatorJsCoreRelease = {
  id: string; repository: string; adapterAbi: string; tag: string; commit: string; metadataUrl: string;
  assets: readonly {filename: string; output: string; sizeBytes: number; sha256: string; url: string; maxSizeBytes: number}[];
};
export function validEmulatorJsCoreRelease(value: unknown): boolean;
export function readEmulatorJsCoreRelease(
  release: EmulatorJsCoreRelease, fetchBytes: (url: string, maximum: number) => Promise<Uint8Array>,
): Promise<Map<string, Buffer>>;
