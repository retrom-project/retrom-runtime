export type ForkAsset = {filename: string; sha256: string; sizeBytes: number; url: string};
export type ForkRelease = {
  runtimeCore: string;
  repository: string;
  tag: string;
  commit: string;
  adapterAbi: string;
  assets: readonly ForkAsset[];
};
export function forkReleaseFiles(catalog: {forks?: readonly ForkRelease[]}):
  Array<ForkAsset & {destination: string; runtimeCore: string}>;
export function verifyForkMetadata(fork: ForkRelease, metadata: unknown): void;
