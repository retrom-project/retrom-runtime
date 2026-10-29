export function resolveSeedOnly(raw: Buffer, filter: {
  apply(bytes: Buffer, seed: number, absoluteOffset: number): unknown;
}, seed: number): Buffer;
