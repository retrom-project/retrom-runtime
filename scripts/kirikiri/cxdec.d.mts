export interface CxProfile {
  mask: number;
  offset: number;
  prologOrder: number[];
  evenBranchOrder: number[];
  oddBranchOrder: number[];
  controlBlock: Uint8Array;
  generator?: "classic";
  /** Recovered legacy callback is connected to this separated filter's manager. */
  legacyBulk?: boolean;
  wrappers?: never[];
  evidence?: Record<string, unknown>;
}
export interface TinyProfile {
  xorConstant: number;
  zeroFallback: number;
  firstByte?: {zeroFallback: number};
  evidence?: Record<string, unknown>;
}
export function createTinyFilter(profile: TinyProfile): {
  apply<T extends Uint8Array>(bytes: T, hash: number, absoluteOffset?: number | bigint): T;
};
export function createCxFilter(profile: CxProfile): {
  apply<T extends Uint8Array>(bytes: T, hash: number, absoluteOffset?: number | bigint): T;
  applyBulk<T extends Uint8Array>(bytes: T, hash: number, absoluteOffset?: number | bigint): T;
  evaluateLane(lane: number, input: number): number;
  programs: ReadonlyArray<{depth: number; byteLength: number}>;
};
export function discoverCxProfiles(bytes: Uint8Array): CxProfile[];
export function discoverTinyProfiles(bytes: Uint8Array): TinyProfile[];
/** maxTotalBytes may tighten the cumulative attempted expansion budget; hard maximum 64 MiB. */
export function extractEmbeddedPeModules(bytes: Uint8Array, options?: {maxTotalBytes?: number}): Buffer[];
