const blockSize = 65536;
const headerSize = 52;
export const checkpointLimit = 384 * 1024 * 1024;
const stateLimit = 64 * 1024 * 1024;
const magic = new TextEncoder().encode("NP2STATE");
const invalid = () => new Error("NP2KAI_CHECKPOINT_INVALID");
function identity(value: string) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {throw invalid();}
  return Uint8Array.from(value.match(/../gu) ?? [], part => parseInt(part, 16));
}
export function encodeState(digest: string, base: Uint8Array, disk: Uint8Array, state: Uint8Array) {
  if (!state.length || state.length > stateLimit || !base.length || base.length !== disk.length) {throw invalid();}
  const blocks: number[] = [];
  let size = headerSize + state.length;
  for (let offset = 0; offset < base.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, base.length);
    for (let index = offset; index < end; index++) {
      if (base[index] !== disk[index]) {blocks.push(offset); size += 8 + end - offset; break;}
    }
  }
  if (size > checkpointLimit) {throw invalid();}
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  bytes.set(magic); bytes.set(identity(digest), 8);
  view.setUint32(40, base.length, true); view.setUint32(44, state.length, true); view.setUint32(48, blocks.length, true);
  bytes.set(state, headerSize); let cursor = headerSize + state.length;
  for (const offset of blocks) {
    const end = Math.min(offset + blockSize, base.length);
    view.setUint32(cursor, offset, true); view.setUint32(cursor + 4, end - offset, true);
    bytes.set(disk.subarray(offset, end), cursor + 8); cursor += 8 + end - offset;
  }
  return bytes;
}
export function decodeState(bytes: Uint8Array, digest: string, base: Uint8Array) {
  if (bytes.length < headerSize || bytes.length > checkpointLimit || magic.some((v, i) => bytes[i] !== v) ||
      identity(digest).some((v, i) => bytes[i + 8] !== v)) {throw invalid();}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stateSize = view.getUint32(44, true), count = view.getUint32(48, true);
  if (view.getUint32(40, true) !== base.length || !stateSize || stateSize > stateLimit ||
      headerSize + stateSize > bytes.length || count > Math.ceil(base.length / blockSize)) {throw invalid();}
  let cursor = headerSize + stateSize, previous = -1;
  const entries: {offset: number; start: number; size: number}[] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 8 > bytes.length) {throw invalid();}
    const offset = view.getUint32(cursor, true), size = view.getUint32(cursor + 4, true); cursor += 8;
    if (!validBlock(offset, previous, size, base.length) || cursor + size > bytes.length) {throw invalid();}
    entries.push({offset, start: cursor, size}); previous = offset; cursor += size;
  }
  if (cursor !== bytes.length) {throw invalid();}
  const disk = base.slice();
  for (const entry of entries) {disk.set(bytes.subarray(entry.start, entry.start + entry.size), entry.offset);}
  return {disk, state: bytes.slice(headerSize, headerSize + stateSize)};
}

function validBlock(offset: number, previous: number, size: number, diskSize: number) {
  return offset > previous && offset % blockSize === 0 && offset < diskSize && size === Math.min(blockSize, diskSize - offset);
}
