import {describe, expect, it, vi} from "vitest";
import {retromShaders} from "./shaders.js";
import {applyEmulatorJsVideoMode} from "./video-mode.js";

describe("unfiltered EmulatorJS output", () => {
  it.each(["pixel", "original"] as const)("keeps %s on an explicit color-preserving shader", (mode) => {
    const changeSettingOption = vi.fn();
    const canvas = document.createElement("canvas");
    expect(applyEmulatorJsVideoMode({canvas, changeSettingOption}, mode)).toBe(true);
    const name = changeSettingOption.mock.lastCall?.[1];
    // Disabling the shader falls back to the 4.2.3 stock GL path, which can
    // retain invalid texture coordinates after a core changes video geometry.
    expect(name).not.toBe("disabled");
    const configured = retromShaders[name];
    expect(configured?.shader.value).toContain("shaders = 1");
    expect(configured?.shader.value).toContain("filter_linear0 = false");
    expect(configured?.resources[0]?.value).toContain("FragColor = COMPAT_TEXTURE(Texture, TEX0.xy);");
    expect(canvas.style.imageRendering).toBe(mode === "pixel" ? "pixelated" : "auto");
  });
});
