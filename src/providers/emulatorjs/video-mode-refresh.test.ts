import {describe, expect, it, vi} from "vitest";
import {createEmulatorJsVideoModeController} from "./video-mode.js";

describe("native video initialization", () => {
  it("reapplies the selected shader after native frames initialize its texture and cancels on exit", () => {
    let frame = 0;
    const pending = new Map<number, FrameRequestCallback>();
    let next = 0;
    const scheduler = {
      requestAnimationFrame(callback: FrameRequestCallback) {pending.set(++next, callback); return next;},
      cancelAnimationFrame(id: number) {pending.delete(id);},
    };
    const advance = () => {const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback(0));};
    const enableShader = vi.fn();
    const instance = {canvas: document.createElement("canvas"), changeSettingOption: vi.fn(), enableShader,
      gameManager: {getFrameNum: () => frame}};
    const controller = createEmulatorJsVideoModeController(instance, scheduler);
    controller.setVideoMode("pixel");
    advance();
    expect(enableShader).not.toHaveBeenCalled();
    frame = 1; advance();
    expect(enableShader).not.toHaveBeenCalled();
    frame = 2; advance();
    expect(enableShader).toHaveBeenCalledExactlyOnceWith("retrom-passthrough");
    expect(pending.size).toBe(0);
    controller.setVideoMode("smooth");
    controller.setVideoMode("sharp-bilinear");
    frame = 3; advance(); frame = 4; advance();
    expect(enableShader).toHaveBeenLastCalledWith("retrom-sharp-bilinear");
    controller.setVideoMode("original");
    controller.cleanup();
    expect(pending.size).toBe(0);
    frame = 6; advance();
    expect(enableShader).toHaveBeenCalledTimes(2);
  });
});
