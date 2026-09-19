/** Existing adapter limits, extracted without changing accepted input sizes. */
export const contentLimits = Object.freeze({
  signedDisc: 2 ** 31 - 1,
  np2kaiDisk: 512 * 1024 * 1024,
  firmwareFile: 64 * 1024 * 1024,
  gbeRom: 0x200000,
  openborPak: 512 * 1024 * 1024,
  webmsxMedia: 16 * 1024 * 1024,
  ruffleSwf: 64 * 1024 * 1024,
  fantasyFile: 8 * 1024 * 1024,
  wasm4Cart: 65536,
  nxengineFile: 32 * 1024 * 1024,
  pspAsset: 128 * 1024 * 1024,
  indexedFile: Number.MAX_SAFE_INTEGER,
});
