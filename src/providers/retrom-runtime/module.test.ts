import {createHash} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type { GameRuntime, GameRuntimeEvent } from "../../contract.js";
import type {LaunchEnvelopeV1, RuntimeEventV1, RuntimeHostV1} from "../../provider/module-api.js";
import {canonicalJsonBytes} from "../../provider/contract.js";
import {projectProviderManifest} from "../../provider/manifest.js";
import {retromRuntimeProviderDefinition} from "./catalog.js";
import { createRetromRuntimePlayer } from "./provider-runtime.js";
import {
  providerApiVersion,
  providerId,
  providerVersion,
  validateLaunchRequest,
} from "./module.js";

const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);
const wasmTargetDigest = digestTarget("wasm4");

beforeEach(() => {vi.stubGlobal("__RETROM_PROVIDER_TARGET_DIGESTS__", {wasm4: wasmTargetDigest});});
afterEach(() => {vi.unstubAllGlobals();});

describe("retrom-runtime Provider Module V1", () => {
  it("exports the exact provider identity and validates its own request", () => {
    expect({providerApiVersion, providerId, providerVersion}).toEqual({
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.12.0",
    });
    const envelope = wasmEnvelope();
    expect(validateLaunchRequest(envelope)).toBe(envelope);
    expect(() => validateLaunchRequest({...envelope, providerId: "leaked"})).toThrow(
      "PROVIDER_LAUNCH_REQUEST_INVALID",
    );
  });

  it("rejects unknown nested fields and declaration mismatches", () => {
    const cases: unknown[] = [];
    for (const mutate of [
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.session, {adapterId: "leaked"}),
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.runtime, {routeKey: "leaked"}),
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.runtime.capabilities, {extra: true}),
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.resources[0], {mountPath: "/game"}),
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.targetOptions, {core: "leaked"}),
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.restore!, {payloadKind: "leaked"}),
      (value: ReturnType<typeof wasmEnvelope>) => {value.runtime.capabilities.pause = false;},
      (value: ReturnType<typeof wasmEnvelope>) => {value.runtime.checkpoint!.maxBytes += 1;},
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.resources[0], {rangeRequired: true}),
      (value: ReturnType<typeof wasmEnvelope>) => Object.assign(value.resources[0], {url: "https://evil.example/cart.wasm"}),
      (value: ReturnType<typeof wasmEnvelope>) => {value.runtime.targetContractSha256 = "d".repeat(64);},
    ]) {
      const candidate = structuredClone(wasmEnvelope());
      mutate(candidate);
      cases.push(candidate);
    }
    for (const candidate of cases) {
      expect(() => validateLaunchRequest(candidate)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    }
  });

  it("adapts the existing lifecycle without losing checkpoint or exit behavior", async () => {
    const events: GameRuntimeEvent[] = [];
    const legacy = fakeRuntime(events);
    const factory = vi.fn(() => legacy.runtime);
    const restore = new Uint8Array([1, 2, 3]);
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => restore),
      mountFrame: vi.fn(async () => {throw new Error("frame not expected");}),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createRetromRuntimePlayer(wasmEnvelope(), host, {}, factory);
    expect(player.getState()).toBe("CREATED");
    expect(player.getCanvas()).toBeNull();
    expect(player.getFrameCount()).toBeNull();

    const received: string[] = [];
    player.subscribe((event) => received.push(event.type));
    const target = document.createElement("div");
    await player.mount(target);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      adapter: expect.objectContaining({adapterKind: "WASM4_WEB"}),
    }), expect.objectContaining({restorePayload: restore}));
    expect(legacy.mount).toHaveBeenCalledWith(target);
    expect(player.getState()).toBe("RUNNING");
    const [, runtimeOptions] = factory.mock.calls[0] as unknown as [
      unknown, {onDiagnostic(diagnostic: {runtime: string; message: string}): void},
    ];
    runtimeOptions.onDiagnostic({runtime: "mkxp-z", message: "startup"});
    expect(host.reportDiagnostic).toHaveBeenCalledWith({
      code: "RETROM_RUNTIME_MKXP_Z", message: "startup",
    });

    events.push({type: "EXIT_REQUESTED"});
    legacy.emit();
    expect(received).toContain("EXIT_REQUESTED");
    await expect(player.checkpoint()).resolves.toEqual({
      bytes: new Uint8Array([4, 5]),
      format: "wasm4-state-v1",
      metadata: null,
    });
    await Promise.all([player.exit(), player.exit()]);
    expect(legacy.exit).toHaveBeenCalledTimes(1);
    expect(player.getState()).toBe("EXITED");
  });

  it("rejects unsupported operations with the stable capability error code", async () => {
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => {throw new Error("unused");}),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createRetromRuntimePlayer(wasmEnvelope(), host, {}, () => fakeRuntime([]).runtime);
    await expect(player.getDiscState()).rejects.toMatchObject({
      code: "PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED",
    });
  });

  it("cleans a failed mount and preserves FAILED as the terminal state", async () => {
    const legacy = fakeRuntime([]);
    legacy.mount.mockRejectedValueOnce(new Error("mount failed"));
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => {throw new Error("unused");}),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createRetromRuntimePlayer(wasmEnvelope(), host, {}, () => legacy.runtime);

    await expect(player.mount(document.createElement("div"))).rejects.toThrow("mount failed");
    expect(legacy.unsubscribe).toHaveBeenCalledOnce();
    expect(legacy.exit).toHaveBeenCalledOnce();
    expect(player.getState()).toBe("FAILED");
    await player.exit();
    expect(player.getState()).toBe("FAILED");
  });

  it("forwards each terminal event at most once", async () => {
    const legacyEvents: GameRuntimeEvent[] = [];
    const legacy = fakeRuntime(legacyEvents);
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => {throw new Error("unused");}),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createRetromRuntimePlayer(wasmEnvelope(), host, {}, () => legacy.runtime);
    const received: string[] = [];
    player.subscribe((event) => received.push(event.type));
    await player.mount(document.createElement("div"));

    legacyEvents.push(
      {type: "EXIT_REQUESTED"}, {type: "EXIT_REQUESTED"},
      {type: "FATAL_ERROR", code: "FIXTURE_FATAL"}, {type: "FATAL_ERROR", code: "FIXTURE_FATAL"},
    );
    legacy.emit();

    expect(received.filter((event) => event === "EXIT_REQUESTED")).toHaveLength(1);
    expect(received.filter((event) => event === "FATAL_ERROR")).toHaveLength(1);
    expect(player.getState()).toBe("FAILED");
    await expect(player.checkpoint()).rejects.toMatchObject({code: "PLAYER_RUNTIME_CONTRACT_INVALID"});
    await player.exit();
    expect(player.getState()).toBe("FAILED");
  });

  it("keeps mount pending until the wrapped runtime is actually ready", async () => {
    const legacy = fakeRuntime([]);
    let completeMount: (() => void) | undefined;
    legacy.mount.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      completeMount = () => resolve(undefined);
    }));
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => {throw new Error("unused");}),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createRetromRuntimePlayer(wasmEnvelope(), host, {}, () => legacy.runtime);
    let settled = false;
    const mounting = player.mount(document.createElement("div"));
    void mounting.finally(() => {settled = true;});
    await vi.waitFor(() => expect(completeMount).toBeTypeOf("function"));
    expect(player.getState()).toBe("MOUNTING");
    expect(settled).toBe(false);
    completeMount?.();
    await mounting;
    expect(player.getState()).toBe("RUNNING");
  });

  it("owns wrapped controls, checkpoint availability, filtering and RPG validation probes", async () => {
    const events: GameRuntimeEvent[] = [];
    const legacy = fakeRuntime(events);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow!;
    const pad = gamepad();
    const nativeGetGamepads = vi.fn(() => [pad] as unknown as Gamepad[]);
    Object.defineProperty(runtimeWindow.navigator, "getGamepads", {
      configurable: true, value: nativeGetGamepads, writable: true,
    });
    const pause = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const setVolume = vi.fn();
    const setVideoMode = vi.fn(async () => undefined);
    Object.assign(legacy.runtime, {
      getCanvas: () => null,
      getFrameCount: () => 88,
      getValidationProbe: (kind: string) => kind === "rpgmaker.position.v1" ? {
        kind, schemaVersion: 1, value: {fixtureState: 4, mapId: 2, playerX: 8, playerY: 9},
      } : null,
      pause, resume, setVideoMode, setVolume,
    });
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: "https://runtime.test"})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createRetromRuntimePlayer(rpgMvEnvelope(), host, {}, () => legacy.runtime);
    await player.setInputFilter({activeGamepadIndex: 0, suppressInput: true});
    const received: RuntimeEventV1[] = [];
    player.subscribe((event) => received.push(event));
    await player.mount(document.createElement("div"));
    expect(host.mountFrame).toHaveBeenCalledWith(expect.any(HTMLElement), {resourceRole: "game"});
    expect(runtimeWindow.navigator.getGamepads).not.toBe(nativeGetGamepads);
    expect(runtimeWindow.navigator.getGamepads()[0]?.buttons.every((button) => !button.pressed && button.value === 0))
      .toBe(true);

    await player.pause();
    await player.pause();
    await player.resume();
    await player.resume();
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    await player.setVolume(0.4);
    expect(setVolume).toHaveBeenCalledWith(0.4);
    await expect(player.setVolume(2)).rejects.toMatchObject({code: "PLAYER_RUNTIME_CONTRACT_INVALID"});
    await player.setVideoMode("pixel");
    expect(setVideoMode).toHaveBeenCalledWith("pixel");
    await player.setVideoMode("smooth");
    expect(setVideoMode).toHaveBeenCalledWith("smooth");
    await expect(player.runValidationProbe("rpgmaker.position.v1", {
      fixtureState: 4, mapId: 2, playerX: 8, playerY: 9,
    })).resolves.toEqual({
      evidence: {fixtureState: 4, mapId: 2, playerX: 8, playerY: 9},
      passed: true,
      probeId: "rpgmaker.position.v1",
    });
    events.push({
      type: "CHECKPOINT_AVAILABILITY_CHANGED",
      availability: {available: false, blocker: "BUSY"},
    });
    legacy.emit();
    expect(received).toContainEqual({
      type: "CHECKPOINT_AVAILABILITY_CHANGED",
      availability: {available: false, reason: "BUSY"},
    });
    await player.exit();
    expect(runtimeWindow.navigator.getGamepads).toBe(nativeGetGamepads);
  });

  it.each(retromRuntimeProviderDefinition.targets.map((target) => [target.id] as const))(
    "closes the %s target lifecycle through the provider contract",
    async (targetId) => {
      const envelope = targetEnvelope(targetId);
      const legacy = fakeRuntime([]);
      const checkpoint = envelope.runtime.checkpoint;
      if (!checkpoint) {throw new Error(`checkpoint contract missing for ${targetId}`);}
      vi.mocked(legacy.runtime.checkpoint).mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]), format: checkpoint.writeFormat,
      });
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const host: RuntimeHostV1 = {
        loadRestore: vi.fn(async () => null),
        mountFrame: vi.fn(async () => ({
          contentWindow: frame.contentWindow!, element: frame, origin: "https://runtime.test",
        })),
        reportDiagnostic: vi.fn(),
        signal: new AbortController().signal,
      };
      const assetIndex = {
        "assets/mkxp/mkxp-z_libretro.js": {sha256: "c".repeat(64), sizeBytes: 1000},
        "assets/mkxp/mkxp-z_libretro.wasm": {sha256: "d".repeat(64), sizeBytes: 2000},
      };
      const player = await createRetromRuntimePlayer(envelope, host, assetIndex, () => legacy.runtime);
      await player.mount(document.createElement("div"));
      const uniqueOrigin = ["rpgmaker-mv", "rpgmaker-mz", "tyranoscript"].includes(targetId);
      expect(host.mountFrame).toHaveBeenCalledTimes(uniqueOrigin ? 1 : 0);
      await expect(player.checkpoint()).resolves.toEqual({
        bytes: new Uint8Array([1, 2, 3]), format: checkpoint.writeFormat, metadata: null,
      });
      await player.exit();
      expect(legacy.exit).toHaveBeenCalledOnce();
      expect(player.getState()).toBe("EXITED");
    },
  );
});

function fakeRuntime(events: GameRuntimeEvent[]) {
  let listener: ((event: GameRuntimeEvent) => void) | undefined;
  const mount = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
  const unsubscribe = vi.fn(() => {listener = undefined;});
  const runtime: GameRuntime = {
    checkpoint: vi.fn(async () => ({bytes: new Uint8Array([4, 5]), format: "wasm4-state-v1"})),
    exit,
    getCanvas: () => null,
    getCapabilities: () => ({
      checkpoint: true, contentSources: ["WASM4_CART_V1"], frameCounter: true, pause: true,
      screenshot: true, standardGamepad: true, validationProbes: [], volume: false,
    }),
    getCheckpointAvailability: () => ({available: true, blocker: null}),
    getFrameCount: () => null,
    getState: () => "RUNNING",
    getValidationProbe: () => null,
    mount,
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob()),
    setVolume: vi.fn(),
    subscribe: (next) => {listener = next; return unsubscribe;},
  };
  return {emit: () => events.splice(0).forEach((event) => listener?.(event)), exit, mount, runtime, unsubscribe};
}

function wasmEnvelope(): LaunchEnvelopeV1 {
  return {
    netplay: null,
    resources: [{
      kind: "WASM4_CART_V1" as const,
      ordinal: 0,
      rangeRequired: false,
      role: "game",
      sha256: digest,
      sizeBytes: 128,
      url: "/runtime/content/game/cart.wasm",
    }],
    restore: {format: "wasm4-state-v1", sha256: digest, sizeBytes: 3, url: "/runtime/launches/id/state"},
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: {
        checkpoint: true,
        discSwitch: false,
        frameCounter: true,
        frameMode: "NONE" as const,
        inputFilter: true,
        nativeSettings: false,
        netplayPort: false,
        pause: true,
        requiresThreads: false,
        screenshot: true,
        standardGamepad: true,
        validationProbes: [],
        videoModes: ["original", "pixel", "smooth"],
        volume: false,
      },
      checkpoint: {maxBytes: 132144, readFormats: ["wasm4-state-v1"], writeFormat: "wasm4-state-v1"},
      gameCompatibilityLine: "wasm4-v1",
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/client.mjs`,
      providerApiVersion: 1 as const,
      providerId: "retrom-runtime",
      providerVersion: "0.12.0",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/`,
      targetContractSha256: wasmTargetDigest,
      targetId: "wasm4",
    },
    schemaVersion: 1 as const,
    session: {
      coreName: "WASM-4 Core",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3",
      mode: "SINGLE" as const,
      platformName: "WASM-4",
      purpose: "PRODUCT" as const,
      returnTo: "/games/fixture",
      title: "Fixture",
      warnings: [],
    },
    targetOptions: {kind: "NONE_V1" as const},
    validation: null,
  };
}

function rpgMvEnvelope(): LaunchEnvelopeV1 {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find(
    (entry) => entry.id === "rpgmaker-mv",
  );
  if (!target || !target.checkpoint) {throw new Error("RPG Maker MV target fixture missing");}
  return {
    netplay: null,
    resources: [{
      bootstrapTicket: "t".repeat(48),
      cleanupUrl: "https://runtime.test/__retrom/cleanup",
      contentDigest: digest,
      entryUrl: "https://runtime.test/__retrom/bootstrap",
      kind: "NATIVE_WEB_V1",
      ordinal: 0,
      origin: "https://runtime.test",
      role: "game",
    }],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: target.capabilities,
      checkpoint: target.checkpoint,
      gameCompatibilityLine: target.gameCompatibilityLine,
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.12.0",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/`,
      targetContractSha256: digestTarget("rpgmaker-mv"),
      targetId: "rpgmaker-mv",
    },
    schemaVersion: 1,
    session: {
      coreName: "RPG Maker Core",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3",
      mode: "SINGLE",
      platformName: "RPG Maker MV",
      purpose: "RUNTIME_VALIDATION",
      returnTo: "/review/fixture",
      title: "Fixture",
      warnings: [],
    },
    targetOptions: {kind: "RPGMAKER_V1", expectedRestorePosition: null},
    validation: {
      input: {fixtureState: 4, mapId: 2, playerX: 8, playerY: 9},
      probeId: "rpgmaker.position.v1",
    },
  };
}

function targetEnvelope(targetId: string): LaunchEnvelopeV1 {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find((entry) => entry.id === targetId);
  if (!target) {throw new Error(`target fixture missing: ${targetId}`);}
  const isRpg = targetId.startsWith("rpgmaker-");
  let resource: LaunchEnvelopeV1["resources"][number];
  if (["rpgmaker-xp", "rpgmaker-vx", "rpgmaker-vx-ace"].includes(targetId)) {
    resource = {
      kind: "SEEKABLE_BLOB_V1", ordinal: 0, rangeRequired: true, role: "game",
      sha256: digest, sizeBytes: 4096, url: `/runtime/content/project/${digest}/game.mkxpz`,
    };
  } else if (["rpgmaker-mv", "rpgmaker-mz"].includes(targetId)) {
    resource = {
      bootstrapTicket: "t".repeat(48), cleanupUrl: "https://runtime.test/__retrom/cleanup",
      contentDigest: digest, entryUrl: "https://runtime.test/__retrom/bootstrap",
      kind: "NATIVE_WEB_V1", ordinal: 0, origin: "https://runtime.test", role: "game",
    };
  } else if (targetId === "tyranoscript") {
    resource = {
      bootstrapTicket: "t".repeat(48), cleanupUrl: "https://runtime.test/__retrom/cleanup",
      contentDigest: digest, entryUrl: "https://runtime.test/__retrom/bootstrap",
      kind: "ISOLATED_WEB_V1", ordinal: 0, origin: "https://runtime.test", role: "game",
    };
  } else if (targetId === "wasm4") {
    resource = {
      kind: "WASM4_CART_V1", ordinal: 0, rangeRequired: false, role: "game",
      sha256: digest, sizeBytes: 128, url: "/runtime/content/game/cart.wasm",
    };
  } else {
    resource = {
      contentDigest: digest, indexUrl: `/runtime/content/project/${digest}/index.json`,
      kind: "FILE_TREE_V1", ordinal: 0, role: "game",
    };
  }
  const targetOptions: LaunchEnvelopeV1["targetOptions"] = isRpg
    ? {kind: "RPGMAKER_V1", expectedRestorePosition: null}
    : targetId === "onscripter-yuri"
      ? {kind: "ONS_PROJECT_V1", scriptEncoding: "utf8"}
      : targetId === "kirikiri2-kag"
        ? {kind: "KIRIKIRI_PROJECT_V1", startupXp3Path: null}
        : {kind: "NONE_V1"};
  return {
    netplay: null,
    resources: [resource],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: target.capabilities,
      checkpoint: target.checkpoint,
      gameCompatibilityLine: target.gameCompatibilityLine,
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/client.mjs`,
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.12.0",
      runtimeBaseUrl: `/runtime/providers/retrom-runtime/${bundleDigest}/`,
      targetContractSha256: digestTarget(targetId),
      targetId,
    },
    schemaVersion: 1,
    session: {
      coreName: "Fixture Core",
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", mode: "SINGLE",
      platformName: "Fixture", purpose: "PRODUCT", returnTo: "/games/fixture", title: "Fixture", warnings: [],
    },
    targetOptions,
    validation: null,
  };
}

function digestTarget(id: string) {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find((entry) => entry.id === id);
  if (!target) {throw new Error("target fixture missing");}
  return createHash("sha256").update(canonicalJsonBytes(target)).digest("hex");
}

function gamepad() {
  return {
    axes: [0.5, -0.5],
    buttons: Array.from({length: 16}, (_, index) => ({
      pressed: index === 0, touched: index === 0, value: index === 0 ? 1 : 0,
    })),
    connected: true,
    id: "fixture-pad",
    index: 0,
    mapping: "standard" as const,
    timestamp: 1,
  };
}
