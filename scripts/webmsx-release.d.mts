export function validWebMSXRelease(release: unknown): boolean;
export function stageWebMSXRelease(release: unknown, metadata: unknown,
  download: (url: string, maximum: number) => Promise<Uint8Array>, stage: URL): Promise<void>;
