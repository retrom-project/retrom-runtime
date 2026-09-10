export type EmulatorJsCoreSource = {
  id: string; repository: string; adapterAbi: string;
  files: readonly {filename: string; output: string; sizeBytes: number; sha256: string}[];
};
export function validEmulatorJsCoreSource(value: unknown): boolean;
export function readEmulatorJsCoreCandidate(source: EmulatorJsCoreSource, directory: string, candidate: boolean): Promise<Map<string, Buffer>>;
export function emulatorJsCoreInputs<T extends {
  forks?: readonly import("./emulatorjs-fork-releases.mjs").ForkRelease[];
  developmentCores?: readonly EmulatorJsCoreSource[];
}>(catalog: T, directories?: Record<string, string>, candidate?: boolean): Omit<T, "forks" | "developmentCores"> & {
  forks: import("./emulatorjs-fork-releases.mjs").ForkRelease[];
  developmentCores: EmulatorJsCoreSource[];
};
