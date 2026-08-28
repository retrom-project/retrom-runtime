export function loadManifest(root: URL): Promise<unknown>;
export function validateManifest(manifest: unknown): void;
export function safePath(value: unknown): boolean;
export function sha256(contents: ArrayBufferView | string): string;
