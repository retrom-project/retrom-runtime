import {createHash} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {LaunchEnvelopeV1, RuntimeHostV1} from "../../provider/module-api.js";
import {canonicalJsonBytes} from "../../provider/contract.js";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {providerApiVersion, providerId, providerVersion, validateLaunchRequest} from "./module.js";

const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);
const fceummTargetDigest = digestTarget("fceumm");

beforeEach(() => {vi.stubGlobal("__RETROM_PROVIDER_TARGET_DIGESTS__", {fceumm: fceummTargetDigest});});
afterEach(() => {vi.unstubAllGlobals();});

describe("EmulatorJS Provider Module V1", () => {
  it("exports one stable Provider identity for both embedded EmulatorJS releases", () => {
    expect({providerApiVersion, providerId, providerVersion}).toEqual({
      providerApiVersion: 1,
      providerId: "emulatorjs",
      providerVersion: "1.0.0",
    });
    const envelope = launchEnvelope();
    expect(validateLaunchRequest(envelope)).toBe(envelope);
  });

  it("projects a target declaration and scoped resources into an isolated EJS frame", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    await player.mount(document.createElement("div"));
    expect(runtimeWindow.EJS_core).toBe("fceumm");
    expect(runtimeWindow.EJS_gameUrl).toBe("/runtime/content/game/game.nes");
    expect(runtimeWindow.EJS_pathtodata).toBe(`/runtime/providers/emulatorjs/${bundleDigest}/assets/4.2.3/data/`);
    expect(runtimeWindow.EJS_paths).toEqual({
      "fceumm-wasm.data": `/runtime/providers/emulatorjs/${bundleDigest}/assets/4.2.3/data/cores/fceumm-wasm.data`,
    });
    expect(runtimeWindow.document.querySelector<HTMLScriptElement>("script[data-retrom-loader]")?.src)
      .toContain(`/runtime/providers/emulatorjs/${bundleDigest}/assets/4.2.3/data/loader.js`);

    const toggleMainLoop = vi.fn();
    runtimeWindow.EJS_emulator = {
      canvas: document.createElement("canvas"),
      gameManager: {getFrameNum: () => 42, getState: () => new Uint8Array([1, 2]), toggleMainLoop},
      on: vi.fn(),
      paused: false,
      setVolume: vi.fn(),
    };
    (runtimeWindow.EJS_ready as () => void)();
    expect(player.getFrameCount()).toBe(42);
    await player.pause();
    await player.resume();
    expect(toggleMainLoop.mock.calls).toEqual([[false], [true]]);
    await expect(player.checkpoint()).resolves.toEqual({
      bytes: new Uint8Array([1, 2]), format: "emulatorjs-state-v1", metadata: null,
    });
    await player.exit();
    expect(player.getState()).toBe("EXITED");
  });

  it("captures the displayed EmulatorJS output instead of raw canvas readback", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    await player.mount(document.createElement("div"));
    const displayed = new Blob(["displayed"], {type: "image/png"});
    const takeScreenshot = vi.fn(async () => ({blob: displayed, format: "png"}));
    runtimeWindow.EJS_emulator = {
      canvas: document.createElement("canvas"),
      capture: {photo: {format: "png", source: "canvas", upscale: 2}},
      gameManager: {},
      takeScreenshot,
    };
    (runtimeWindow.EJS_ready as () => void)();

    await expect(player.screenshot()).resolves.toBe(displayed);
    expect(takeScreenshot).toHaveBeenCalledWith("canvas", "png", 2);
  });
});

function launchEnvelope(): LaunchEnvelopeV1 {
  return {
    netplay: null,
    resources: [{
      kind: "ROM_BLOB_V1" as const,
      ordinal: 0,
      rangeRequired: false,
      role: "game",
      sha256: digest,
      sizeBytes: 128,
      url: "/runtime/content/game/game.nes",
    }],
    restore: null,
    runtime: {
      bundleSha256: bundleDigest,
      capabilities: {
        checkpoint: true, discSwitch: false, frameCounter: true, frameMode: "SAME_ORIGIN_BLANK" as const,
        inputFilter: true, nativeSettings: true, netplayPort: true, pause: true, requiresThreads: false,
        screenshot: true, standardGamepad: true, validationProbes: [],
        videoModes: ["adaptive-sharpen", "original", "pixel", "sharp-bilinear", "smooth"],
        volume: true,
      },
      checkpoint: {maxBytes: 268435456, readFormats: ["emulatorjs-state-v1"], writeFormat: "emulatorjs-state-v1"},
      gameCompatibilityLine: "fceumm-v1",
      moduleSha256: digest,
      moduleUrl: `/runtime/providers/emulatorjs/${bundleDigest}/client.mjs`,
      providerApiVersion: 1 as const,
      providerId: "emulatorjs",
      providerVersion: "1.0.0",
      runtimeBaseUrl: `/runtime/providers/emulatorjs/${bundleDigest}/`,
      targetContractSha256: fceummTargetDigest,
      targetId: "fceumm",
    },
    schemaVersion: 1 as const,
    session: {
      id: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", mode: "SINGLE" as const,
      platformName: "NES", purpose: "PRODUCT" as const, returnTo: "/games/fixture",
      title: "Fixture", warnings: [],
    },
    targetOptions: {dosEntryPath: null, initialDiscIndex: null, kind: "EMULATORJS_V1" as const},
    validation: null,
  };
}

function digestTarget(id: string) {
  const target = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === id);
  if (!target) {throw new Error("target fixture missing");}
  return createHash("sha256").update(canonicalJsonBytes(target)).digest("hex");
}
