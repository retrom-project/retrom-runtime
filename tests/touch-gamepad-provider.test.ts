import {afterEach, describe, expect, it, vi} from "vitest";
import {createRetromRuntimePlayer} from "../src/providers/retrom-runtime/provider-runtime.js";
import {mountTargetAdapter} from "../src/providers/retrom-runtime/target-adapter.js";
import {adapterFixture, deferred, hostFixture} from "./provider-adapter-fixture.js";
import {targetEnvelope} from "./provider-fixtures.js";

vi.mock("../src/content-io/bootstrap.js", () => ({bootstrapContentSession: vi.fn(async () => ({close: vi.fn(async () => {}), fail: vi.fn()}))}));
vi.mock("../src/providers/retrom-runtime/target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));
afterEach(() => {vi.mocked(mountTargetAdapter).mockReset(); document.body.replaceChildren();});

function frameWithTouchFirstMedia() {
  const host = hostFixture();
  const mountFrame = host.mountFrame;
  host.mountFrame = vi.fn(async (...args: Parameters<typeof mountFrame>) => {
    const frame = await mountFrame(...args);
    Object.defineProperty(frame.contentWindow, "matchMedia", {configurable: true, value: () => ({matches: true})});
    // Browsers expose the Gamepad API in every frame; jsdom does not.
    Object.defineProperty(frame.contentWindow.navigator, "getGamepads", {configurable: true, value: () => [null, null, null, null]});
    return frame;
  });
  return host;
}

describe("Provider on-screen touch gamepad", () => {
  it("keeps controls visible and neutral during a background checkpoint without showing a paused pad", async () => {
    const saved = {bytes: Uint8Array.of(4, 5), format: "wasm4-state-v1"};
    let capture = deferred<typeof saved>();
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapterFixture({touchGamepad: true, checkpoint: () => capture.promise}));
    const host = frameWithTouchFirstMedia();
    const player = createRetromRuntimePlayer(targetEnvelope("wasm4"), host, {});
    await player.mount(document.createElement("div"));
    const realm = (await vi.mocked(host.mountFrame).mock.results[0]!.value).contentWindow as Window;
    const root = realm.document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
    let pending: ReturnType<typeof player.checkpoint> | undefined;
    try {
      root.querySelector('[data-face="bottom"]')!.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch"}));
      expect(realm.navigator.getGamepads()[0]?.buttons[0].pressed).toBe(true);
      pending = player.checkpoint();
      await vi.waitFor(() => expect(player.getState()).toBe("CHECKPOINTING"));
      expect(root.hidden).toBe(false);
      expect(realm.navigator.getGamepads()[0]?.buttons.every(button => !button.pressed)).toBe(true);
      capture.resolve(saved); await pending;
      await player.pause();
      capture = deferred<typeof saved>(); pending = player.checkpoint();
      await vi.waitFor(() => expect(player.getState()).toBe("CHECKPOINTING"));
      expect(root.hidden).toBe(true);
      capture.resolve(saved); await pending;
      expect(root.hidden).toBe(true);
    } finally {capture.resolve(saved); await pending; await player.exit();}
  });

  it("installs in a nested input realm and applies the initial preference before RUNNING", async () => {
    let child: Window | undefined;
    vi.mocked(mountTargetAdapter).mockImplementation(async (_envelope, _target, input) => {
      const frame = input.frameWindow.document.createElement("iframe");
      input.frameWindow.document.body.append(frame);
      child = frame.contentWindow!;
      Object.defineProperty(child, "matchMedia", {configurable: true, value: () => ({matches: true})});
      Object.defineProperty(child.navigator, "getGamepads", {configurable: true, value: () => [null]});
      return adapterFixture({touchGamepad: {layout: "JOYSTICK", inputWindow: child}});
    });
    const host = frameWithTouchFirstMedia(); host.touchGamepadEnabled = false;
    const player = createRetromRuntimePlayer(targetEnvelope("apple2-apple2js"), host, {});
    await player.mount(document.createElement("div"));
    const controls = player.getTouchGamepad?.();
    expect(controls?.getState()).toEqual({enabled: false});
    expect(child!.navigator.getGamepads()[0]).toBeNull();
    const root = child!.document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
    expect(root.hidden).toBe(true);
    await controls!.setEnabled(true);
    expect(root.hidden).toBe(false);
    expect(child!.navigator.getGamepads()[0]?.mapping).toBe("standard");
    await player.pause(); expect(root.hidden).toBe(true);
    await player.resume(); expect(root.hidden).toBe(false);
    await player.exit();
    expect(child!.document.querySelector("[data-retrom-touch-gamepad]")).toBeNull();
    expect(player.getTouchGamepad?.()).toBeNull();
  });

  it("joins the same-origin frame's standard gamepads only for opted-in adapters and is removed on exit", async () => {
    for (const touchGamepad of [true, undefined] as const) {
      vi.mocked(mountTargetAdapter).mockResolvedValue(adapterFixture(touchGamepad ? {touchGamepad} : {}));
      const host = frameWithTouchFirstMedia();
      const player = createRetromRuntimePlayer(targetEnvelope("rpgmaker-vx-ace"), host, {});
      await player.mount(document.createElement("div"));
      const frameWindow = (await vi.mocked(host.mountFrame).mock.results[0]!.value).contentWindow as Window;
      const overlay = frameWindow.document.querySelector("[data-retrom-touch-gamepad]");
      expect(Boolean(overlay)).toBe(Boolean(touchGamepad));
      expect(frameWindow.navigator.getGamepads()[0]?.id ?? null).toBe(touchGamepad ? "Retrom touch gamepad (STANDARD GAMEPAD)" : null);
      await player.exit();
      expect(frameWindow.document.querySelector("[data-retrom-touch-gamepad]")).toBeNull();
    }
  });
});
