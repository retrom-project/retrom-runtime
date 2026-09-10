import {describe, expect, it} from "vitest";
import {gzipSync} from "fflate";
import {decodeLegacyMkxpCheckpoint as decodeMkxpCheckpoint} from "./legacy-mkxp-checkpoint.js";
const coreSize = 16;
describe("legacy mkxp compact checkpoints", () => {
  it("restores the exact buffer from the historical compressed prefix", async () => {
    const raw = new Uint8Array(1 << 20); raw.set(coreState());
    expect(await decodeMkxpCheckpoint(encodeMkxpCheckpoint(raw), raw.length)).toEqual(raw);
  });

  it("retains the historical raw fallback", async () => {
    const raw = coreState();
    expect(Buffer.from(await decodeMkxpCheckpoint(raw, raw.length)).equals(Buffer.from(raw))).toBe(true);
  });

  it.each([
    ["container magic", 0],
    ["raw size", 8],
    ["prefix size", 12],
    ["stored size", 16],
    ["codec", 20],
  ])("rejects an invalid compact %s", async (_name, offset) => {
    const rawSize = 1 << 20;
    const raw = new Uint8Array(rawSize);
    raw.set(coreState());
    const encoded = encodeMkxpCheckpoint(raw);
    encoded[offset] ^= 0xff;

    await expect(decodeMkxpCheckpoint(encoded, rawSize)).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
  });

  it("rejects truncated compressed data", async () => {
    const rawSize = 1 << 20;
    const raw = new Uint8Array(rawSize);
    raw.set(coreState());
    const encoded = encodeMkxpCheckpoint(raw);

    await expect(decodeMkxpCheckpoint(encoded.slice(0, -1), rawSize))
      .rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
  });
});

function coreState() {
  const core = new Uint8Array(coreSize);
  core.set([0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0]);
  core.set([8, 9, 10, 11, 12, 13, 14, 15], 8);
  return core;
}

function encodeMkxpCheckpoint(raw: Uint8Array) {
  const prefix = raw.slice(0, 16), gzip = gzipSync(prefix, {mtime: 0});
  const encoded = new Uint8Array(24 + gzip.length);
  encoded.set([0x52, 0x54, 0x4d, 0x4b, 0x58, 0x50, 0x53, 1]);
  const view = new DataView(encoded.buffer);
  for (const [offset, value] of [[8, raw.length], [12, prefix.length], [16, gzip.length], [20, 1]]) {view.setUint32(offset, value, true);}
  encoded.set(gzip, 24); return encoded;
}
