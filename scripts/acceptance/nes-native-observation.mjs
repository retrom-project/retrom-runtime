/* global window */
/** Read the pinned FCEUmm core's ordinary, tagged native savestate. Never alter RAM or input. */
export function observeNESCheckpoint() {
  const manager = window.EJS_emulator?.gameManager;
  if (!manager?.getState) {throw new Error("NES_NATIVE_CHECKPOINT_UNAVAILABLE");}
  const bytes = manager.getState(), tag = [82, 65, 77, 0, 0, 8, 0, 0], matches = [];
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength < 2048 + tag.length) {throw new Error("NES_NATIVE_CHECKPOINT_INVALID");}
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= data.length - 2048 - tag.length; offset++) {
    if (tag.every((value, index) => data[offset + index] === value)) {matches.push(offset + tag.length);}
  }
  if (matches.length !== 1) {throw new Error("NES_NATIVE_RAM_TAG_INVALID");}
  const ram = matches[0];
  return {format: "FCEUMM_TAGGED_RAM", checkpointBytes: data.length, ramOffset: ram,
    frameCounter: data[ram], p1Counter: data[ram + 3], p2Counter: data[ram + 4]};
}
