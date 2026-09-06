import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {RuntimeEventV1, RuntimeHostV1} from "../../provider/module-api.js";
import {adapterFixture, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {gamepad, rpgMvEnvelope, targetEnvelope, wasmEnvelope} from "../../../tests/provider-fixtures.js";
import {retromRuntimeProviderDefinition} from "./catalog.js";
import {createRetromRuntimePlayer} from "./provider-runtime.js";
import {mountTargetAdapter} from "./target-adapter.js";
import * as provider from "./module.js";

vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));
beforeEach(() => {vi.mocked(mountTargetAdapter).mockReset();});
afterEach(() => {document.body.replaceChildren(); vi.useRealTimers();});

describe("retrom-runtime Provider Module V1", () => {
  it("exposes ordinary play controls without a production proof interface", async () => {
    const player = await provider.createRuntime(wasmEnvelope(), hostFixture());
    expect(player).not.toHaveProperty("runValidationProbe");
    expect(player.getCapabilities()).not.toHaveProperty("validationProbes");
    for (const target of retromRuntimeProviderDefinition.targets.filter((entry) => entry.id.startsWith("rpgmaker-"))) {
      expect(target.targetOptionsSchema).toEqual({
        additionalProperties: false, properties: {}, required: [], type: "object",
      });
    }
    await player.exit();
  });

  it("exports only the current provider entry and exact identity", async () => {
    expect(Object.keys(provider).sort()).toEqual(["createRuntime", "providerApiVersion", "providerId", "providerVersion"]);
    expect(provider).toMatchObject({providerApiVersion: 1, providerId: "retrom-runtime", providerVersion: "0.17.0-dev.10"});
    expect((await provider.createRuntime(wasmEnvelope(), hostFixture())).getState()).toBe("CREATED");
    await expect(provider.createRuntime({...wasmEnvelope(), providerId: "leaked"}, hostFixture()))
      .rejects.toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });

  it("rejects a Host that does not implement the closed Provider Module ABI", async () => {
    const host: RuntimeHostV1 = hostFixture();
    Reflect.deleteProperty(host, "signal");
    await expect(provider.createRuntime(wasmEnvelope(), host)).rejects.toThrow("PROVIDER_HOST_INVALID");
  });

  it("rejects unknown nested fields and declaration mismatches at creation", async () => {
    for (const mutate of [
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.session, {adapterId: "leaked"}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.runtime, {routeKey: "leaked"}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.runtime.capabilities, {extra: true}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.runtime.capabilities, {validationProbes: []}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v, {validation: null}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.session, {purpose: "RUNTIME_VALIDATION"}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.resources[0], {mountPath: "/game"}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.targetOptions, {core: "leaked"}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.restore!, {payloadKind: "leaked"}),
      (v: ReturnType<typeof wasmEnvelope>) => {v.runtime.capabilities.pause = false;},
      (v: ReturnType<typeof wasmEnvelope>) => {v.runtime.checkpoint!.maxBytes += 1;},
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.resources[0], {rangeRequired: true}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.resources[0], {url: "https://evil.example/cart.wasm"}),
      (v: ReturnType<typeof wasmEnvelope>) => Object.assign(v.runtime, {targetContractSha256: "d".repeat(64)}),
    ]) {
      const candidate = structuredClone(wasmEnvelope());
      mutate(candidate);
      await expect(provider.createRuntime(candidate, hostFixture())).rejects.toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    }
    expect(mountTargetAdapter).not.toHaveBeenCalled();
  });

  it("passes restore bytes and diagnostics directly to a core adapter", async () => {
    const adapter = adapterFixture();
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const restore = Uint8Array.of(1, 2, 3);
    const host = hostFixture({loadRestore: vi.fn(async () => restore)});
    const player = await provider.createRuntime(wasmEnvelope(), host);
    await player.mount(document.createElement("div"));
    expect(mountTargetAdapter).toHaveBeenCalledWith(wasmEnvelope(), expect.objectContaining({id: "game"}),
      expect.objectContaining({restorePayload: restore}));
    vi.mocked(mountTargetAdapter).mock.calls[0][2].onDiagnostic({runtime: "mkxp-z", message: "startup"});
    expect(host.reportDiagnostic).toHaveBeenCalledWith({code: "RETROM_RUNTIME_MKXP_Z", message: "startup"});
    await expect(player.checkpoint()).resolves.toEqual({bytes: Uint8Array.of(4, 5), format: "wasm4-state-v1", metadata: null});
    await Promise.all([player.exit(), player.exit()]);
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("rejects unsupported operations with the stable capability error", async () => {
    const player = await provider.createRuntime(wasmEnvelope(), hostFixture());
    for (const action of [
      () => player.getDiscState(), () => player.switchDisc(1), () => player.getNetplayPort(),
      () => player.openNativeSettings("core"), () => player.closeNativeSettings(), () => player.setVolume(0.5),
    ]) {await expect(action()).rejects.toMatchObject({code: "PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED"});}
    await player.exit();
  });

  it.each(retromRuntimeProviderDefinition.targets.map((target) => target.id))(
    "mounts %s with its declared frame surface and checkpoint contract",
    async (targetId) => {
      const envelope = targetEnvelope(targetId);
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const runtimeWindow = frame.contentWindow!;
      Object.defineProperties(runtimeWindow, {
        innerHeight: {configurable: true, value: 820}, innerWidth: {configurable: true, value: 1280},
      });
      let canvas: HTMLCanvasElement | null = null;
      const adapter = adapterFixture({
        getCanvas: () => canvas,
        checkpoint: vi.fn(async () => ({bytes: Uint8Array.of(1, 2, 3), format: envelope.runtime.checkpoint!.writeFormat})),
      });
      vi.mocked(mountTargetAdapter).mockImplementation(async (_request, mountTarget) => {
        if (envelope.runtime.capabilities.frameMode === "SAME_ORIGIN_BLANK") {
          canvas = mountTarget.ownerDocument.createElement("canvas");
          canvas.width = 320;
          canvas.height = 240;
          mountTarget.append(canvas);
        }
        return adapter;
      });
      const host = hostFixture({mountFrame: vi.fn(async () => ({
        contentWindow: runtimeWindow, element: frame, origin: location.origin,
      }))});
      const player = createRetromRuntimePlayer(envelope, host, {});
      const outerTarget = document.createElement("div");
      await player.mount(outerTarget);
      const sameOriginBlank = envelope.runtime.capabilities.frameMode === "SAME_ORIGIN_BLANK";
      expect(host.mountFrame).toHaveBeenCalledWith(outerTarget, {resourceRole: sameOriginBlank ? null : "game"});
      const mountTarget = vi.mocked(mountTargetAdapter).mock.calls[0][1];
      if (sameOriginBlank) {
        expect(mountTarget.id).toBe("game");
        expect(mountTarget.ownerDocument).toBe(frame.contentDocument);
        expect(frame.contentDocument?.querySelector("style[data-retrom-runtime-frame]")).not.toBeNull();
        expect(player.getCanvas()?.style).toMatchObject({width: "1093px", height: "820px", left: "93px", top: "0px"});
      } else {expect(mountTarget).toBe(outerTarget);}
      await expect(player.checkpoint()).resolves.toEqual({
        bytes: Uint8Array.of(1, 2, 3), format: envelope.runtime.checkpoint!.writeFormat, metadata: null,
      });
      await player.exit();
      expect(adapter.exit).toHaveBeenCalledOnce();
      expect(player.getState()).toBe("EXITED");
    },
  );

  it("owns idempotent controls, input filtering and video", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow!;
    const focus = vi.spyOn(runtimeWindow, "focus").mockImplementation(() => undefined);
    const nativeGetGamepads = vi.fn(() => [gamepad()]);
    Object.defineProperty(runtimeWindow.navigator, "getGamepads", {
      configurable: true, value: nativeGetGamepads, writable: true,
    });
    const adapter = adapterFixture({
      getFrameCount: () => 88, setVideoMode: vi.fn(async () => undefined),
    });
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = createRetromRuntimePlayer(rpgMvEnvelope(), hostFixture({mountFrame: async () => ({
      contentWindow: runtimeWindow, element: frame, origin: "https://runtime.test",
    })}), {});
    await player.setInputFilter({activeGamepadIndex: 0, suppressInput: true});
    const received: RuntimeEventV1[] = [];
    player.subscribe((event) => received.push(event));
    await player.mount(document.createElement("div"));
    expect(runtimeWindow.navigator.getGamepads).not.toBe(nativeGetGamepads);
    expect(runtimeWindow.navigator.getGamepads()[0]?.buttons.every((button) => !button.pressed && !button.value)).toBe(true);
    await player.pause();
    await player.pause();
    expect(focus).not.toHaveBeenCalled();
    await player.resume();
    await player.resume();
    expect(focus).toHaveBeenCalledOnce();
    expect(adapter.pause).toHaveBeenCalledOnce();
    expect(adapter.resume).toHaveBeenCalledOnce();
    await player.setVolume(0.4);
    expect(adapter.setVolume).toHaveBeenCalledWith(0.4);
    await expect(player.setVolume(2)).rejects.toMatchObject({code: "PLAYER_RUNTIME_CONTRACT_INVALID"});
    await player.setVideoMode("pixel");
    await player.setVideoMode("smooth");
    expect(adapter.setVideoMode).toHaveBeenNthCalledWith(1, "pixel");
    expect(adapter.setVideoMode).toHaveBeenNthCalledWith(2, "smooth");
    expect(player.getFrameCount()).toBe(88);
    await player.exit();
    expect(runtimeWindow.navigator.getGamepads).toBe(nativeGetGamepads);
  });
});
