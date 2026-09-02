import {afterEach, describe, expect, it, vi} from "vitest";

import {installArchiveWorkerCompatibility} from "./archive-worker.js";

const nativeFetch = window.fetch;
afterEach(() => {window.fetch = nativeFetch;});

describe("EmulatorJS archive worker compatibility", () => {
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
