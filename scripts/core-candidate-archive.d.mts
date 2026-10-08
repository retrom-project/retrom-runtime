export function validCandidateArchive(value: unknown): boolean;
export function packCoreCandidateDirectory(directory: string): Promise<Uint8Array>;
export function verifyPinnedCoreDirectory(source: unknown, directory: string, descriptor: unknown): Promise<void>;
export function unpackPinnedCoreArchive(source: unknown, bytes: Uint8Array): Record<string, Uint8Array>;
