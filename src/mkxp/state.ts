import { gunzip, gzip } from "fflate";

export const mkxpRastateEnvelopeBytes = 24;
export const mkxpCompactHeaderBytes = 24;
const rastateHeader = [0x52, 0x41, 0x53, 0x54, 0x41, 0x54, 0x45, 1] as const;
const memoryTag = [0x4d, 0x45, 0x4d, 0x20] as const;
const endTag = [0x45, 0x4e, 0x44, 0x20] as const;
const compactHeader = [0x52, 0x54, 0x4d, 0x4b, 0x58, 0x50, 0x53, 1] as const;
const gzipCodec = 1;

export async function encodeMkxpCheckpoint(core: Uint8Array, expectedCoreSize: number) {
  validateMkxpCoreState(core, expectedCoreSize);
  const prefixSize = await significantPrefixSize(core);
  const compressed = await compress(core.slice(0, prefixSize));
  if (compressed.byteLength + mkxpCompactHeaderBytes >= core.byteLength) {return core.slice();}
  const checkpoint = new Uint8Array(mkxpCompactHeaderBytes + compressed.byteLength);
  checkpoint.set(compactHeader);
  const view = new DataView(checkpoint.buffer);
  view.setUint32(8, expectedCoreSize, true);
  view.setUint32(12, prefixSize, true);
  view.setUint32(16, compressed.byteLength, true);
  view.setUint32(20, gzipCodec, true);
  checkpoint.set(compressed, mkxpCompactHeaderBytes);
  return checkpoint;
}

export async function decodeMkxpCheckpoint(checkpoint: Uint8Array, expectedCoreSize: number) {
  try {
    if (checkpoint.byteLength === expectedCoreSize) {
      validateMkxpCoreState(checkpoint, expectedCoreSize);
      return checkpoint.slice();
    }
    if (checkpoint.byteLength <= mkxpCompactHeaderBytes || !matchesBytes(checkpoint, 0, compactHeader)) {
      throw new Error("invalid compact checkpoint");
    }
    const view = new DataView(checkpoint.buffer, checkpoint.byteOffset, checkpoint.byteLength);
    const rawSize = view.getUint32(8, true);
    const prefixSize = view.getUint32(12, true);
    const compressedSize = view.getUint32(16, true);
    if (rawSize !== expectedCoreSize || prefixSize < 8 || prefixSize > rawSize || compressedSize < 1 ||
      compressedSize !== checkpoint.byteLength - mkxpCompactHeaderBytes || view.getUint32(20, true) !== gzipCodec ||
      gzipOriginalSize(checkpoint) !== prefixSize) {
      throw new Error("invalid compact checkpoint");
    }
    const prefix = await decompress(checkpoint.slice(mkxpCompactHeaderBytes));
    if (prefix.byteLength !== prefixSize) {throw new Error("invalid compact checkpoint");}
    const core = new Uint8Array(rawSize);
    core.set(prefix);
    validateMkxpCoreState(core, expectedCoreSize);
    return core;
  } catch {
    throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
  }
}

export function decodeMkxpRastate(state: Uint8Array, expectedCoreSize: number) {
  const endOffset = 16 + expectedCoreSize;
  if (state.byteLength !== expectedCoreSize + mkxpRastateEnvelopeBytes || expectedCoreSize < 8) {
    throw new Error("RPG_CHECKPOINT_CREATE_FAILED");
  }
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  if (!matchesBytes(state, 0, rastateHeader) || !matchesBytes(state, 8, memoryTag) ||
    view.getUint32(12, true) !== expectedCoreSize || !matchesBytes(state, endOffset, endTag) ||
    view.getUint32(endOffset + 4, true) !== 0) {
    throw new Error("RPG_CHECKPOINT_CREATE_FAILED");
  }
  const core = state.slice(16, endOffset);
  validateMkxpCoreState(core, expectedCoreSize);
  return core;
}

export function encodeMkxpRastate(core: Uint8Array, expectedCoreSize: number) {
  validateMkxpCoreState(core, expectedCoreSize);
  const state = new Uint8Array(expectedCoreSize + mkxpRastateEnvelopeBytes);
  const endOffset = 16 + expectedCoreSize;
  const view = new DataView(state.buffer);
  state.set(rastateHeader, 0);
  state.set(memoryTag, 8);
  view.setUint32(12, expectedCoreSize, true);
  state.set(core, 16);
  state.set(endTag, endOffset);
  view.setUint32(endOffset + 4, 0, true);
  return state;
}

function validateMkxpCoreState(core: Uint8Array, expectedCoreSize: number) {
  if (core.byteLength !== expectedCoreSize || expectedCoreSize < 8 ||
    !matchesBytes(core, 0, [0x6d, 0x6b, 0x78, 0x70]) ||
    new DataView(core.buffer, core.byteOffset, core.byteLength).getUint32(4, true) !== 1) {
    throw new Error("RPG_CHECKPOINT_CREATE_FAILED");
  }
}

async function significantPrefixSize(core: Uint8Array) {
  const scanChunkBytes = 1 << 20;
  let size = core.byteLength;
  while (size > 8) {
    const boundary = Math.max(8, size - scanChunkBytes);
    while (size > boundary && core[size - 1] === 0) {size -= 1;}
    if (size > boundary) {return size;}
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return size;
}

function gzipOriginalSize(checkpoint: Uint8Array) {
  const offset = checkpoint.byteLength - 4;
  return new DataView(checkpoint.buffer, checkpoint.byteOffset + offset, 4).getUint32(0, true);
}

function compress(bytes: Uint8Array) {
  return new Promise<Uint8Array>((resolve, reject) => {
    gzip(bytes, { consume: true, level: 6, mtime: 0 }, (error, result) => {
      if (error) {reject(error);}
      else {resolve(result);}
    });
  });
}

function decompress(bytes: Uint8Array) {
  return new Promise<Uint8Array>((resolve, reject) => {
    gunzip(bytes, { consume: true }, (error, result) => {
      if (error) {reject(error);}
      else {resolve(result);}
    });
  });
}

function matchesBytes(bytes: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}
