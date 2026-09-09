// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {loadPlay} from "./core.js";
import {verifiedFetch} from "../fantasy-console/fetch.js";
vi.mock("../fantasy-console/fetch.js", () => ({verifiedFetch: vi.fn(async () => new Uint8Array([1]))}));
afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});
it("resolves relative Provider assets in a blank child frame", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow;
  if (!win) {throw Error("frame missing");}
  const module = {RETROM_PLAY_ABI: "play-host-v1"};
  Object.assign(win, {__RETROM_PLAY_CORE_MODULE_V1__: module});
  const append = vi.spyOn(win.document.head, "append").mockImplementation((...nodes) => {
    const script = nodes[0] as HTMLScriptElement;
    expect(script.src).toBe(new URL("/provider/assets/play/play-retrom.mjs", window.location.href).href);
    queueMicrotask(() => script.dispatchEvent(new Event("load")));
  });
  const assetIndex = Object.fromEntries(["Play.js", "Play.wasm", "checkpoint.mjs", "input.mjs", "play-retrom.mjs", "range-device.mjs"]
    .map(file => [`assets/play/${file}`, {sizeBytes: 1, sha256: "a".repeat(64)}]));
  const result = await loadPlay({runtimeBaseUrl: "/provider/assets/play/", assetIndex,
    disc: {kind: "SEEKABLE_BLOB", rangeRequired: true, url: "/disc.chd", sizeBytes: 10, sha256: "b".repeat(64)}}, win);
  expect(result).toBe(module); expect(append).toHaveBeenCalledOnce();
  expect(verifiedFetch).toHaveBeenCalledWith(new URL("/provider/assets/play/Play.wasm", window.location.href).href,
    1, "a".repeat(64), undefined);
});
