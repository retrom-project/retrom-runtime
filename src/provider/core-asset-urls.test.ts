import {afterEach, expect, it, vi} from "vitest";
import {CoreAssetURLs} from "./core-asset-urls.js";
import {loadCoreAsset} from "./core-assets.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {deferred} from "../../tests/provider-adapter-fixture.js";
vi.mock("./core-assets.js", () => ({loadCoreAsset: vi.fn()}));
afterEach(() => {vi.clearAllMocks(); vi.unstubAllGlobals();});
const path = "assets/core.wasm", bytes = new Uint8Array([0, 97, 115, 109]);
function fixture(signal?: AbortSignal) {
  const owner = contentSessionFixture(location.origin);
  const create = vi.fn(() => "blob:owned"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {static createObjectURL = create; static revokeObjectURL = revoke;});
  return {owner, create, revoke, urls: new CoreAssetURLs({contentSession: owner.session,
    assetIndex: {[path]: {sha256: "a".repeat(64), sizeBytes: bytes.length}}}, "/provider/", signal)};
}
it("shares a pending asset within an instance and releases its URL once on exit", async () => {
  const pending = deferred<Uint8Array>(); vi.mocked(loadCoreAsset).mockReturnValue(pending.promise);
  const f = fixture();
  try {
    const first = f.urls.url(path), second = f.urls.url(path); expect(first).toBe(second);
    pending.resolve(bytes); expect(await first).toBe("blob:owned");
    expect(loadCoreAsset).toHaveBeenCalledTimes(1);
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({size: 4, type: "application/wasm"}));
    f.urls.close(); f.urls.close(); expect(f.revoke).toHaveBeenCalledExactlyOnceWith("blob:owned");
    await expect(f.urls.url(path)).rejects.toThrow("CONTENT_IO_ABORTED");
  } finally {f.urls.close(); await f.owner.close();}
});
it.each(["exit", "abort"])("does not leak a late download after %s", async action => {
  const pending = deferred<Uint8Array>(); vi.mocked(loadCoreAsset).mockReturnValue(pending.promise);
  const controller = new AbortController(), f = fixture(controller.signal);
  try {
    const result = f.urls.url(path).catch(error => error);
    if (action === "exit") {f.urls.close();} else {controller.abort();}
    pending.resolve(bytes); expect(await result).toBeInstanceOf(Error);
    expect(f.create).not.toHaveBeenCalled();
  } finally {f.urls.close(); await f.owner.close();}
});
it("does not retain or convert failed integrity checks into executable URLs", async () => {
  const f = fixture(); vi.mocked(loadCoreAsset).mockRejectedValueOnce(new Error("CONTENT_IO_INTEGRITY_MISMATCH"));
  try {
    await expect(f.urls.url(path)).rejects.toThrow("CONTENT_IO_INTEGRITY_MISMATCH");
    expect(f.create).not.toHaveBeenCalled();
    vi.mocked(loadCoreAsset).mockResolvedValueOnce(bytes);
    await expect(f.urls.url(path)).resolves.toBe("blob:owned");
    expect(loadCoreAsset).toHaveBeenCalledTimes(2);
  } finally {f.urls.close(); await f.owner.close();}
});
