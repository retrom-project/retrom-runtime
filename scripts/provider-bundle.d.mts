export type ProviderBundleInput = {
  archiveRoot: string;
  assetSources: Map<string, string>;
  bundleRoot: string;
  clientModuleBytes: Uint8Array;
  licenseSources: Map<string, string>;
  manifest: {
    schemaVersion: 1;
    providerId: string;
    providerVersion: string;
    providerApiVersion: 1;
    clientModulePath: "client.mjs";
    targets: Array<{assetPaths: string[]} & Record<string, unknown>>;
  };
  provenance: Record<string, unknown>;
};

export type ProviderBundleResult = {
  archivePath: string;
  bundleRoot: string;
  bundleSha256: string;
  bundleSizeBytes: number;
  fileCount: number;
  manifestSha256: string;
  unpackedSizeBytes: number;
};

export function buildProviderBundle(input: ProviderBundleInput): Promise<ProviderBundleResult>;
export function verifyProviderBundle(bundleRoot: string): Promise<void>;
export function providerMediaType(path: string): string;
