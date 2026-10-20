export type ProviderBundleInput = {
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
  bundleRoot: string;
  bundleSha256: string;
  fileCount: number;
  manifestSha256: string;
  unpackedSizeBytes: number;
};

export function buildProviderBundle(input: ProviderBundleInput): Promise<ProviderBundleResult>;
export function verifyProviderBundle(bundleRoot: string): Promise<void>;
export function providerBundleSha256(bundleRoot: string): Promise<string>;
export function deterministicTarGz(entries: Array<[string, Uint8Array]>): Buffer;
export function readDeterministicTarGz(bytes: Uint8Array): Array<[string, Buffer]>;
export function providerMediaType(path: string): string;
