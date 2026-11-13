export interface PrefixXorProfile {shift: number; boundary: number}
export function discoverPrefixProfiles(input: Uint8Array): PrefixXorProfile[];
export function createPrefixFilter(profile: PrefixXorProfile): {
  unchangedSeed(seed: number): boolean;
  apply<T extends Uint8Array>(bytes: T, seed: number, offset?: number): T;
};
