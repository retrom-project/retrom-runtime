export interface NativeTlgProfile {version: number; signature: string; widthXor: number; heightXor: number}
export function discoverNativeTlgProfiles(input: Uint8Array): NativeTlgProfile[];
export function rewriteNativeTlg(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, profiles: NativeTlgProfile[]): AsyncGenerator<Uint8Array>;
