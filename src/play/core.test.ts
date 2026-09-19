import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {loadPlay} from "./core.js";
import {materializeFileBytes} from "../provider/content-inputs.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
vi.mock("../provider/content-inputs.js", () => ({materializeFileBytes: vi.fn(async () => new Uint8Array([1]))}));
afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});
it("resolves relative Provider assets in a blank child frame", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow;
  if (!win) {throw Error("frame missing");}
  const module = {RETROM_PLAY_ABI: "play-host-v2"};
  Object.assign(win, {__RETROM_PLAY_CORE_MODULE_V1__: module});
  const append = vi.spyOn(win.document.head, "append").mockImplementation((...nodes) => {
    const script = nodes[0] as HTMLScriptElement;
    expect(script.src).toBe(new URL("/provider/assets/play/play-retrom.mjs", window.location.href).href);
    queueMicrotask(() => script.dispatchEvent(new Event("load")));
  });
  const target=retromRuntimeProviderDefinition.targets.find(target=>target.id==="play-ps2")!;
  const assetIndex=Object.fromEntries(target.assetPaths.filter(path=>path.startsWith("assets/play/")).map(path=>[path,{sizeBytes:1,sha256:"a".repeat(64)}]));
  const owner = contentSessionFixture(location.origin);
  const result = await loadPlay({runtimeBaseUrl: "/provider/assets/play/", assetIndex,
    disc: {kind: "SEEKABLE_BLOB", rangeRequired: true, url: "/disc.chd", sizeBytes: 10, sha256: "b".repeat(64)}}, win, undefined, owner.session);
  expect(result).toBe(module); expect(append).toHaveBeenCalledOnce();
  expect(materializeFileBytes).toHaveBeenCalledWith(owner.session, {url: new URL("/provider/assets/play/Play.wasm", window.location.href).href,
    sizeBytes: 1, sha256: "a".repeat(64)}, expect.objectContaining({mode: "EAGER", result: "BYTES"}), "CORE_ASSET", undefined);
  await owner.close();
});
