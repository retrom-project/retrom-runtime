import {afterEach, describe, expect, it, vi} from "vitest";
import {createRetromRuntimePlayer} from "../src/providers/retrom-runtime/provider-runtime.js";
import {mountTargetAdapter} from "../src/providers/retrom-runtime/target-adapter.js";
import {adapterFixture, hostFixture} from "./provider-adapter-fixture.js";
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
