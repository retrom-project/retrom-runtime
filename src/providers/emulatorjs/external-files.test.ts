import {afterEach, describe, expect, it, vi} from "vitest";

import {installExternalFileCompatibility} from "./external-files.js";

afterEach(() => {Reflect.deleteProperty(window, "EJS_GameManager");});

describe("EmulatorJS external files", () => {
  it("normalizes cross-realm ArrayBuffer writes and restores the constructor boundary", () => {
    const cleanup = installExternalFileCompatibility(window);
    const writeFile = vi.fn();
    class Manager {writeFile(path: string, value: unknown) {return writeFile(path, value);}}
    Reflect.set(window, "EJS_GameManager", Manager);
    const manager = new Manager() as Manager & {writeFile: (path: string, value: ArrayBuffer) => void};
    manager.writeFile("/disc.chd", Uint8Array.of(1, 2, 3).buffer);
    expect(writeFile).toHaveBeenCalledWith("/disc.chd", Uint8Array.of(1, 2, 3));
    cleanup();
    expect(Reflect.has(window, "EJS_GameManager")).toBe(false);
  });
});
