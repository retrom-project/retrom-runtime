import {afterEach, describe, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {verifiedFetch} from "./fetch.js";
afterEach(() => vi.unstubAllGlobals());
describe("bounded fantasy cartridge and asset downloads", () => {
  it("verifies exact bytes and rejects truncation and corruption", async () => {
    const bytes = new Uint8Array([1, 2, 3]), digest = createHash("sha256").update(bytes).digest("hex");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    expect(await verifiedFetch("/cart", 3, digest)).toEqual(bytes);
    await expect(verifiedFetch("/cart", 4, digest)).rejects.toThrow("FANTASY_CONTENT_INTEGRITY_FAILED");
    await expect(verifiedFetch("/cart", 3, "0".repeat(64))).rejects.toThrow("FANTASY_CONTENT_INTEGRITY_FAILED");
  });
  it("cancels an oversized stream before reading its remaining contents", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(4));}, cancel});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    await expect(verifiedFetch("/cart", 3, "0".repeat(64))).rejects.toThrow("FANTASY_CONTENT_SIZE_INVALID");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
