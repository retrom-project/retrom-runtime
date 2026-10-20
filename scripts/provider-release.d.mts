export type ProviderBuildRecord = {
  bundleDirectory: string;
  bundleSha256: string;
  chunkDirectory: string;
  chunkManifest: {asset: string; sha256: string; sizeBytes: number};
  fileCount: number;
  manifestSha256: string;
  providerId: string;
  providerVersion: string;
  unpackedSizeBytes: number;
};

export type ProviderBuildMetadata = {
  providers: ProviderBuildRecord[];
  schemaVersion: 1;
  sourceTreeSha256: string;
};

export type ProviderReleaseIdentity = {commit: string; repository: string; tag: string};
export type ProviderReleaseMetadata = {
  providers: ProviderBuildRecord[];
  release: ProviderReleaseIdentity;
  schemaVersion: 1;
};

export function createProviderBuildMetadata(
  providers: ProviderBuildRecord[], sourceTreeSha256: string,
): ProviderBuildMetadata;
export function pinProviderReleaseMetadata(
  build: ProviderBuildMetadata, release: ProviderReleaseIdentity,
): ProviderReleaseMetadata;
export function sourceTreeSha256(repositoryRoot?: string): string;
