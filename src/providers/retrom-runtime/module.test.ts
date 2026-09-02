import {createHash} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type { GameRuntime, GameRuntimeEvent } from "../../contract.js";
import type { LaunchEnvelopeV1, RuntimeHostV1 } from "../../provider/module-api.js";
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
});

function fakeRuntime(events: GameRuntimeEvent[]) {
  let listener: ((event: GameRuntimeEvent) => void) | undefined;
  const mount = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
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
    subscribe: (next) => {listener = next; return () => {listener = undefined;};},
  };
  return {emit: () => events.splice(0).forEach((event) => listener?.(event)), exit, mount, runtime};
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

function digestTarget(id: string) {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find((entry) => entry.id === id);
  if (!target) {throw new Error("target fixture missing");}
  return createHash("sha256").update(canonicalJsonBytes(target)).digest("hex");
}
