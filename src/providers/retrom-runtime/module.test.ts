import {gzipSync} from "fflate";
import {decodeStoredCheckpoint, nativeCheckpointFormat} from "../../provider/checkpoint-storage.js";
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
  it("fits a non-square-pixel core to its display aspect without changing its frame buffer", async () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const realm = frame.contentWindow!;
    const canvas = realm.document.createElement("canvas"); canvas.width = 560; canvas.height = 192;
    const adapter = Object.assign(adapterFixture({getCanvas: () => canvas}), {getDisplayAspectRatio: () => 4 / 3});
    vi.mocked(mountTargetAdapter).mockImplementation(async (_request, target) => {target.append(canvas); return adapter;});
    const host = hostFixture({mountFrame: vi.fn(async () => ({contentWindow: realm, element: frame, origin: location.origin}))});
    const player = createRetromRuntimePlayer(wasmEnvelope(), host, {});
    try {
      await player.mount(document.createElement("div"));
      for (const [width, height, expectedWidth, expectedHeight] of [[1000, 900, 1000, 750], [600, 600, 600, 450], [1200, 900, 1200, 900]]) {
        Object.defineProperties(realm, {innerWidth: {configurable: true, value: width}, innerHeight: {configurable: true, value: height}});
        realm.dispatchEvent(new Event("resize"));
        expect(canvas.style.width).toBe(`${expectedWidth}px`); expect(canvas.style.height).toBe(`${expectedHeight}px`);
        expect([canvas.width, canvas.height]).toEqual([560, 192]);
      }
    } finally {await player.exit();}
  });
  it("leaves a core-owned responsive canvas untouched across buffer and viewport resizes", async () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const realm = frame.contentWindow!;
    const canvas = realm.document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%";
    const original = canvas.style.cssText;
    const adapter = Object.assign(adapterFixture({getCanvas: () => canvas}), {canvasLayout: "CORE" as const});
    vi.mocked(mountTargetAdapter).mockImplementation(async (_request, target) => {
      const host = realm.document.createElement("div");
      host.attachShadow({mode: "open"}).append(canvas); target.append(host);
      return adapter;
    });
    const host = hostFixture({mountFrame: vi.fn(async () => ({contentWindow: realm, element: frame, origin: location.origin}))});
    const player = createRetromRuntimePlayer(wasmEnvelope(), host, {});
    try {
      await player.mount(document.createElement("div"));
      expect(canvas.style.cssText).toBe(original);
      for (const [width, height] of [[1920, 1080], [900, 1280], [1280, 900]]) {
        Object.defineProperties(realm, {innerWidth: {configurable: true, value: width}, innerHeight: {configurable: true, value: height}});
        canvas.width = width * 2; canvas.height = height * 2;
        realm.dispatchEvent(new Event("resize"));
        await Promise.resolve();
        expect(canvas.style.cssText).toBe(original);
      }
    } finally {await player.exit();}
  });
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
    expect(provider).toMatchObject({providerApiVersion: 1, providerId: "retrom-runtime", providerVersion: "0.0.0-dev"});
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
    const host = hostFixture({loadRestore: vi.fn(async () => gzipSync(restore))});
    const player = await provider.createRuntime(wasmEnvelope(), host);
    await player.mount(document.createElement("div"));
    expect(mountTargetAdapter).toHaveBeenCalledWith(wasmEnvelope(), expect.objectContaining({id: "game"}),
      expect.objectContaining({restorePayload: restore}));
    vi.mocked(mountTargetAdapter).mock.calls[0][2].onDiagnostic({runtime: "mkxp-z", message: "startup"});
    expect(host.reportDiagnostic).toHaveBeenCalledWith({code: "RETROM_RUNTIME_MKXP_Z", message: "startup"});
    const saved = await player.checkpoint();
    expect(saved.format).toBe("wasm4-state-v1-storage-v1");
    expect(await decodeStoredCheckpoint(saved.bytes, saved.format, 132144)).toEqual(Uint8Array.of(4, 5));
    await Promise.all([player.exit(), player.exit()]);
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("rejects unsupported operations with the stable capability error", async () => {
    const player = await provider.createRuntime(wasmEnvelope(), hostFixture());
    for (const action of [
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
        checkpoint: vi.fn(async () => ({bytes: Uint8Array.of(1, 2, 3), format: nativeCheckpointFormat(envelope.runtime.checkpoint!.writeFormat)})),
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
      const saved = await player.checkpoint();
      expect(saved.format).toBe(envelope.runtime.checkpoint!.writeFormat);
      expect(saved.metadata).toBeNull();
      expect(await decodeStoredCheckpoint(saved.bytes, saved.format, envelope.runtime.checkpoint!.maxBytes)).toEqual(Uint8Array.of(1, 2, 3));
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
    const envelope = rpgMvEnvelope();
    envelope.runtime.capabilities = {...envelope.runtime.capabilities, frameMode: "SAME_ORIGIN_BLANK"};
    const player = createRetromRuntimePlayer(envelope, hostFixture({mountFrame: async () => ({
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
  it("delivers isolated input policy through the adapter without reading cross-origin window properties", async () => {
    const accessed = vi.fn();
    const isolated = new Proxy({} as Window, {get(_target, key) {
      accessed(key); throw new DOMException("Blocked cross-origin access", "SecurityError");
    }});
    const frame = document.createElement("iframe");
    const setInputFilter = vi.fn(async () => {});
    const adapter = Object.assign(adapterFixture({getCanvas: () => null}), {setInputFilter});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const host = hostFixture({mountFrame: async () => ({contentWindow: isolated, element: frame, origin: "https://runtime.test"})});
    const player = createRetromRuntimePlayer(rpgMvEnvelope(), host, {});
    const first = {activeGamepadIndex: 0, suppressInput: true};
    await player.setInputFilter(first);
    await player.mount(document.createElement("div"));
    expect(setInputFilter).toHaveBeenCalledWith(first);
    const second = {activeGamepadIndex: 1, suppressInput: false};
    await player.setInputFilter(second);
    await player.setInputFilter(null);
    expect(setInputFilter.mock.calls).toEqual([[first], [second], [null]]);
    expect(accessed).not.toHaveBeenCalled();
    await player.exit();
  });
});
