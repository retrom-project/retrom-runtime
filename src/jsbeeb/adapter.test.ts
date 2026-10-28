import {targetContentFixture} from "../../tests/target-content-fixture.js";
// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {mountJsbeeb} from "./adapter.js";
import {adapterTouchFixture} from "../../tests/adapter-touch-fixture.js";

afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});

it("boots with verified external ROM bytes and restores a checkpoint in a new frame", async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/game");
  URL.revokeObjectURL = vi.fn();
  try {
    const runtimeFrame = document.createElement("iframe"); document.body.append(runtimeFrame);
    const frameWindow = runtimeFrame.contentWindow!;
    expect(frameWindow.location.href).toBe("about:blank");
    const target = frameWindow.document.createElement("div"); frameWindow.document.body.append(target);
    const bios = ["os.rom", "BASIC.ROM", "DFS-1.2.rom"].map((logicalName) => ({
      logicalName, virtualPath: `roms/${logicalName === "DFS-1.2.rom" ? "b/" : ""}${logicalName}`,
      url: `https://example.test/${logicalName}`, sha256: "a".repeat(64), sizeBytes: 3,
    }));
    const session = {
      open: async (source: {url: string}) => ({id: source.url, close: async () => undefined}),
      materialize: async () => ({kind: "BYTES" as const, bytes: new Uint8Array([1, 2, 3])}),
      closeFile: async () => undefined,
    };
    const mounted = mountJsbeeb({game: {url: "/runtime/content/game/game.ssd", sha256: "b".repeat(64), sizeBytes: 3},
      bios, runtimeBaseUrl: "/assets/jsbeeb/site/"}, target, frameWindow,
      new Uint8Array([5, 6]), () => undefined, targetContentFixture(session as never, "bbc-jsbeeb"));
    await vi.waitFor(() => expect(target.querySelector("iframe")).not.toBeNull());
    const iframe = target.querySelector("iframe")!;
    const focus = vi.spyOn(iframe, "focus");
    const child = iframe.contentWindow as Window & {RetromJsbeeb?: object};
    child.document.open();
    child.document.write("<!doctype html><html><head></head><body></body></html>");
    child.document.close();
    const siteDocument = child.document;
    const canvas = document.createElement("canvas");
    canvas.toBlob = (callback) => callback(new Blob(["png"], {type: "image/png"}));
    const restore = vi.fn(async () => undefined);
    const stop = vi.fn();
    child.RetromJsbeeb = {canvas, checkpoint: async () => new Uint8Array([31, 139]),
      restore, pause: () => undefined, resume: () => undefined, stop};
    const adapter = await mounted;
    expect(iframe.src).toContain("retrom=1");
    expect(iframe.src).toContain("disc1=blob");
    expect(new URL(iframe.src).search).toBe("");
    expect(new URL(iframe.src).hash).toContain("retrom=1");
    expect(restore).toHaveBeenCalledWith(new Uint8Array([5, 6]));
    expect(focus).toHaveBeenCalledOnce();
    siteDocument.dispatchEvent(new Event("pointerdown", {bubbles: true}));
    expect(focus).toHaveBeenCalledTimes(2);
    await adapter.resume();
    expect(focus).toHaveBeenCalledTimes(3);
    expect((frameWindow as Window & {RetromJsbeebBios?: object}).RetromJsbeebBios).toBeDefined();
    expect(await adapter.checkpoint()).toEqual({format: "jsbeeb-snapshot-gzip-v1", bytes: new Uint8Array([31, 139])});
    expect((await adapter.screenshot()).type).toBe("image/png");
    const touch = adapterTouchFixture(adapter, frameWindow);
    try {
      expect(touch.realm).toBe(child);
      touch.press('[data-face="bottom"]');
      expect(child.navigator.getGamepads()[0]?.buttons[0].pressed).toBe(true);
      await touch.touch.setEnabled(false);
      expect(child.navigator.getGamepads()[0]).toBeNull();
      expect(touch.root.hidden).toBe(true);
    } finally {touch.dispose();}
    const focusCalls = focus.mock.calls.length;
    await adapter.exit();
    siteDocument.dispatchEvent(new Event("pointerdown", {bubbles: true}));
    expect(focus).toHaveBeenCalledTimes(focusCalls);
    expect(stop).toHaveBeenCalledOnce();
    expect((frameWindow as Window & {RetromJsbeebBios?: object}).RetromJsbeebBios).toBeUndefined();
    expect(target.querySelector("iframe")).toBeNull();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
