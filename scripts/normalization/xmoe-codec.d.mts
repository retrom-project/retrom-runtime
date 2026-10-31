export interface XmoeProfile {
  archiveName: string;
  key: Uint8Array;
  headerXors: {version: number; count: number; packed: number; raw: number};
  hashSeed: number;
  payloadMagic: number;
  rotation: number;
  startMarker: number;
  endMarker: number;
}
export const xmoeLimits: Readonly<{image: number; index: number; file: number; tree: number; entries: number; name: number}>;
export function inspectXmoeHeader(header: Buffer, profile: XmoeProfile, sourceSize: number): {count: number; offset: number; packed: number; raw: number};
export function inspectXmoeArchive(header: Buffer, indexPacked: Buffer, profile: XmoeProfile, sourceSize: number, signal?: AbortSignal): {name: string; offset: number; packed: number}[];
export function decodeXmoePayload(payload: Buffer, profile: XmoeProfile, signal?: AbortSignal): Buffer;
