import {vi} from "vitest";
import type {MountedRuntimeAdapter} from "../src/internal-adapter.js";
import type {RuntimeHostV1} from "../src/provider/module-api.js";
import {blankFrame} from "./provider-fixtures.js";

export function adapterFixture(overrides: Partial<MountedRuntimeAdapter> = {}) {
  return {
    checkpoint: vi.fn(async () => ({bytes: Uint8Array.of(4, 5), format: "wasm4-state-v1"})),
    exit: vi.fn(async () => undefined),
    getCanvas: vi.fn(() => null),
    getCheckpointAvailability: vi.fn(() => ({available: true, blocker: null} as const)),
    getFrameCount: vi.fn(() => 300),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob([Uint8Array.of(1)], {type: "image/png"})),
    setVolume: vi.fn(),
    ...overrides,
  } satisfies MountedRuntimeAdapter;
}

export function hostFixture(overrides: Partial<RuntimeHostV1> = {}): RuntimeHostV1 {
  return {
    loadRestore: vi.fn(async () => null),
    mountFrame: vi.fn(async () => blankFrame()),
    reportDiagnostic: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

export function currentWindowHost(restorePayload: Uint8Array | null = null): RuntimeHostV1 {
  return hostFixture({
    loadRestore: async () => restorePayload,
    mountFrame: async () => ({contentWindow: window, element: document.createElement("iframe"), origin: location.origin}),
  });
}
