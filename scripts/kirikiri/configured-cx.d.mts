export interface ConfiguredCxProfile {
  params: Uint8Array;
  controlBlock: Uint8Array;
}
export function discoverConfiguredProfiles(input: Uint8Array): ConfiguredCxProfile[];
export function createConfiguredFilter(profile: ConfiguredCxProfile): {
  apply<T extends Uint8Array>(bytes: T, seed: number, offset?: number): T;
};
