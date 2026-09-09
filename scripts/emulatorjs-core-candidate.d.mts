export type EmulatorJsCoreSource = {
  id: string; repository: string; adapterAbi: string;
  files: readonly {filename: string; output: string; sizeBytes: number; sha256: string}[];
};
export function validEmulatorJsCoreSource(value: unknown): boolean;
export function readEmulatorJsCoreCandidate(source: EmulatorJsCoreSource, directory: string, candidate: boolean): Promise<Map<string, Buffer>>;
