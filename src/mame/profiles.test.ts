import {expect, it} from "vitest";
import {validateGame} from "./profiles.js";

function atom(size = 4, start = 0x2800) {
  const bytes = new Uint8Array(22 + size), header = new DataView(bytes.buffer);
  header.setUint16(16, start, true); header.setUint16(18, start, true); header.setUint16(20, size, true);
  return bytes;
}
it("accepts a complete ATM image and rejects truncation, extra data, empty payload and address wrap", () => {
  expect(() => validateGame("atom", atom())).not.toThrow();
  for (const bytes of [atom().subarray(0, 24), new Uint8Array([...atom(), 0]), atom(0), atom(4, 65534)]) {
    expect(() => validateGame("atom", bytes)).toThrow("MAME_CONTENT_INVALID");
  }
});
