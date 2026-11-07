export interface InlineXorProfile {shifts: number[]; mask: number; boundary: number}
export function discoverInlineProfiles(input: Uint8Array): InlineXorProfile[];
export function createInlineFilter(profile: InlineXorProfile): {
  unchangedSeed(seed: number): boolean;
  apply<T extends Uint8Array>(bytes: T, seed: number, offset?: number): T;
};
