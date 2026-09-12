export function validPinnedCoreAssets(release: unknown): boolean;
export function usesPinnedCoreAssets(id: string): boolean;
export function stagePinnedCoreIfNeeded(release: unknown, metadata: unknown, download: (url: string, maximum: number) => Promise<Uint8Array>, stage: URL): Promise<boolean>;
export function stagePinnedCoreRelease(release: unknown, metadata: unknown, download: (url: string, maximum: number) => Promise<Uint8Array>, stage: URL): Promise<void>;
