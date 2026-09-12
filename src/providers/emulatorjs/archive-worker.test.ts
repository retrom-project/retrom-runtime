import {afterEach, describe, expect, it, vi} from "vitest";

import {installArchiveWorkerCompatibility} from "./archive-worker.js";

const nativeFetch = window.fetch;
afterEach(() => {window.fetch = nativeFetch;});

describe("EmulatorJS archive worker compatibility", () => {
  it("loads FreeIntv's pinned report without its hourly cache buster", async () => {
    const original = vi.fn<typeof fetch>(async () => new Response("{}"));
    window.fetch = original;
    const base = "/runtime/providers/emulatorjs/digest/assets/4.3.0-pre/data/";
    const report = new URL(base + "cores/reports/freeintv.json", location.href).href;
    const cleanup = installArchiveWorkerCompatibility(window, "4.3.0-pre", base, "freeintv");
    try {
      await window.fetch(report + "?v=497021");
      expect(original).toHaveBeenLastCalledWith(report, undefined);
      const request = new Request(report + "?v=497021", {headers: {"X-Test": "preserved"}});
      await window.fetch(request);
      const forwarded = original.mock.calls.at(-1)?.[0] as unknown as Request;
      expect(forwarded.url).toBe(report);
      expect(forwarded.headers.get("X-Test")).toBe("preserved");
      for (const url of [report + "?v=1&extra=2", report + "?v=changed", report.replace("freeintv", "other") + "?v=1",
        "https://example.com/cores/reports/freeintv.json?v=1"]) {
        await window.fetch(url);
        expect(original).toHaveBeenLastCalledWith(url, undefined);
      }
      const init = {method: "POST"};
      await window.fetch(report + "?v=1", init);
      expect(original).toHaveBeenLastCalledWith(report + "?v=1", init);
    } finally {cleanup();}
    expect(window.fetch).toBe(original);
  });

  it("rewrites the 4.3 response worker without eval and restores fetch", async () => {
    const runtimeWindow = window as Window & {fetch: typeof fetch};
    const original = vi.fn(async () => new Response([
      'eval("_"+_0x222174)',
      "eval(_0x370f8c)",
    ].join(";")));
    runtimeWindow.fetch = original;
    const cleanup = installArchiveWorkerCompatibility(
      runtimeWindow,
      "4.3.0-pre",
      "/runtime/providers/emulatorjs/digest/assets/4.3.0-pre/data/",
    );
    const response = await runtimeWindow.fetch(
      "/runtime/providers/emulatorjs/digest/assets/4.3.0-pre/data/compression/extract7z.js",
    );
    expect(await response.text()).not.toContain("eval(");
    cleanup();
    expect(runtimeWindow.fetch).toBe(original);
  });

  it("fails closed when a pinned worker fragment changes", async () => {
    const runtimeWindow = window as Window & {fetch: typeof fetch};
    runtimeWindow.fetch = vi.fn(async () => new Response("changed worker"));
    const cleanup = installArchiveWorkerCompatibility(
      runtimeWindow,
      "4.3.0-pre",
      "/runtime/providers/emulatorjs/digest/assets/4.3.0-pre/data/",
    );
    await expect(runtimeWindow.fetch(
      "/runtime/providers/emulatorjs/digest/assets/4.3.0-pre/data/compression/extract7z.js",
    )).rejects.toThrow("PLAYER_ARCHIVE_COMPATIBILITY_UNAVAILABLE");
    cleanup();
  });
});
