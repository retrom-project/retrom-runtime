export function loadProviderSources(root: URL): Promise<unknown>;
export function validateProviderSources(sources: unknown): void;
export function safePath(value: unknown): boolean;
export function sha256(contents: ArrayBufferView | string): string;
