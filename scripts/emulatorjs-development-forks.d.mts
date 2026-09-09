export type DevelopmentForkAsset = {filename: string; sha256: string; sizeBytes: number};
export type DevelopmentFork = {
  runtimeCore: string; repository: string; upstreamCommit: string; commit: string;
  sourceTreeSha256: string; adapterAbi: string; assets: readonly DevelopmentForkAsset[];
};
export type DevelopmentForkCatalog = {developmentForks?: readonly DevelopmentFork[]};
export function validEmulatorJsDevelopmentSource(value: unknown): boolean;
export function developmentForkFiles(catalog: DevelopmentForkCatalog):
  Array<DevelopmentForkAsset & {destination: string; runtimeCore: string}>;
export function requireDevelopmentForkMode(catalog: DevelopmentForkCatalog, allowed?: boolean): void;
export function verifyDevelopmentForkMetadata(fork: DevelopmentFork, metadata: unknown): void;
export function stageDevelopmentForks(catalog: DevelopmentForkCatalog,
  roots: ReadonlyMap<string, string> | undefined, destinationRoot: string): Promise<void>;
