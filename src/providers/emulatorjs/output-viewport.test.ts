import {afterEach, describe, expect, it, vi} from "vitest";
import {fitEmulatorJsOutput, installEmulatorJsOutputViewport} from "./output-viewport.js";

afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});

describe("bounded EmulatorJS output viewport", () => {
  it("bounds the buffer while preserving aspect and the visible display area", () => {
    const result = fitEmulatorJsOutput(2560, 1440, {width: 960, height: 544});
    expect(result).toEqual({width: 960, height: 540, scale: 2560 / 960, left: 0, top: 0});
    const portrait = fitEmulatorJsOutput(3039, 2160, {width: 960, height: 544});
    expect(portrait.width).toBeLessThanOrEqual(960);
    expect(portrait.height).toBeLessThanOrEqual(544);
    expect(portrait.width * portrait.scale).toBeLessThanOrEqual(3039);
    expect(portrait.height * portrait.scale).toBeLessThanOrEqual(2160);
    expect(fitEmulatorJsOutput(480, 270, {width: 960, height: 544}).scale).toBe(1);
  });

  it("resizes with its container, restores full output for shaders, and cleans up", () => {
    const target = document.createElement("div");
    const frame = document.createElement("iframe");
    frame.style.width = "100%";
    target.append(frame); document.body.append(target);
    Object.defineProperties(target, {clientWidth: {value: 2560, configurable: true}, clientHeight: {value: 1440}});
    let refresh = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {constructor(callback: () => void) {refresh = callback;} observe() {} disconnect = disconnect;});
    const viewport = installEmulatorJsOutputViewport(frame, target, {width: 960, height: 544});
    expect(frame.style.width).toBe("960px");
    expect(frame.style.height).toBe("540px");
    viewport.setVideoMode("smooth");
    expect(frame.style.width).toBe("100%");
    viewport.setVideoMode("pixel");
    expect(frame.style.width).toBe("960px");
    viewport.setVideoMode("original");
    expect(frame.style.width).toBe("960px");
    Object.defineProperty(target, "clientWidth", {value: 1280}); refresh();
    expect(parseFloat(frame.style.height)).toBeLessThanOrEqual(544);
    viewport.cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frame.style.width).toBe("100%");
    expect(frame.style.transform).toBe("");
    refresh();
    expect(frame.style.width).toBe("100%");
  });
});
