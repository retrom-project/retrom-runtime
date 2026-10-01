import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {createStreamingContentHasher} from "./bounded-stream.js";

describe("bounded streaming integrity", () => {
  it("hashes irregular chunks and final partial blocks without retaining the content", async () => {
    const expected = createHash("sha256");
    const hash = await createStreamingContentHasher(32 * 1024 * 1024);
    try {
      for (let i = 0; i < 83; i++) {
        const bytes = Uint8Array.from({length: i * 7919 % 262144 + 1}, (_, j) => (i * 17 + j) & 255);
        expected.update(bytes); hash.update(bytes);
        bytes.fill(0); // The caller may immediately recycle its bounded buffer.
      }
      expect(hash.digest()).toBe(expected.digest("hex"));
    } finally {hash.destroy();}
  });
  it("still verifies all bytes when the browser prohibits Wasm compilation", async () => {
    const instantiate = vi.spyOn(WebAssembly, "instantiate").mockRejectedValue(new Error("CSP"));
    const hash = await createStreamingContentHasher(32 * 1024 * 1024);
    try {
      hash.update(Uint8Array.of(1, 2)); hash.update(Uint8Array.of(3));
      expect(hash.digest()).toBe(createHash("sha256").update(Uint8Array.of(1, 2, 3)).digest("hex"));
    } finally {hash.destroy(); instantiate.mockRestore();}
  });
});
