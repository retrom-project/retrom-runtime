import {PlayerRuntimeError} from "../../provider/errors.js";

const nestopiaTrackedInputStateBytes = 8;

export function canonicalizeEmulatorJsNetplayState(value: Uint8Array, profileId: string) {
  const state = new Uint8Array(value);
  const core = coreStateBytes(state);
  if (profileId !== "nestopia-423-v1") {return state;}
  const range = nestopiaTrackedInputRange(core);
  if (range) {core.fill(0, range.start, range.end);}
  return state;
}

export function coreStateBytes(value: Uint8Array) {
  if (new TextDecoder().decode(value.subarray(0, 7)) !== "RASTATE" || value[7] !== 1) {throw contractError();}
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  for (let offset = 8; offset + 8 <= value.byteLength;) {
    const marker = new TextDecoder().decode(value.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > value.byteLength) {throw contractError();}
    if (marker === "MEM ") {return value.subarray(start, end);}
    if (marker === "END ") {break;}
    offset = start + ((size + 7) & ~7);
  }
  throw contractError();
}

function nestopiaTrackedInputRange(value: Uint8Array) {
  if (value.byteLength < 32 || value[0] !== 0x4e || value[1] !== 0x53 ||
    value[2] !== 0x54 || value[3] !== 0x1a) {return null;}
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const rootBytes = view.getUint32(4, true);
  if (rootBytes < 16 || value[8] !== 0x4e || value[9] !== 0x46 || value[10] !== 0x4f ||
    value[11] !== 0 || view.getUint32(12, true) !== 8) {return null;}
  const start = 8 + rootBytes;
  const end = start + nestopiaTrackedInputStateBytes;
  return end <= value.byteLength ? {start, end} : null;
}

function contractError() {
  return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID");
}
