import {describe, expect, it} from "vitest";
import {disableEmulatorDownloadCache} from "./download-cache.js";
import type {EjsWindow} from "./emulator-instance.js";

describe("EmulatorJS download cache configuration", () => {
  it.each(["4.2.3", "4.3.0-pre"] as const)("uses the declared loader interface in %s without the obsolete byte limit", release => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const target: EjsWindow | null = frame.contentWindow;
    if (!target) {throw new Error("frame unavailable");}
    try {
      disableEmulatorDownloadCache(target, release);
      expect(Reflect.has(target, "EJS_CacheLimit")).toBe(false);
      if (release === "4.2.3") {
        expect(target.EJS_disableDatabases).toBe(true);
        expect(target.EJS_cacheConfig).toBeUndefined();
      } else {
        expect(target.EJS_cacheConfig?.enabled).toBe(false);
        expect(target.EJS_disableDatabases).toBeUndefined();
      }
    } finally {frame.remove();}
  });
});
