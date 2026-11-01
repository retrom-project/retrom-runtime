export interface RollingXorProfile { table: Uint8Array }
export function discoverRollingProfiles(input: Uint8Array): RollingXorProfile[];
export function createRollingFilter(profile: RollingXorProfile): {
  apply<T extends Uint8Array>(bytes: T, seed: number, offset?: number): T;
};
