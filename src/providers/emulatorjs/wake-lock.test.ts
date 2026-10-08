import "../../../tests/emulatorjs-content-fixture.js";
import {afterEach, expect, it, vi} from "vitest";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

afterEach(() => {document.body.replaceChildren();});

it("owns successful optional Wake Lock requests until the player exits", async () => {
  const sentinel = {release: vi.fn(async () => {}), released: false};
  const nativeRequest = vi.fn(async () => sentinel);
  const fixture = await mount(nativeRequest);
  try {
    // RetroArch retains request('screen') without awaiting it while enabling.
    const pending = fixture.wakeLock.request("screen");
    expect(await pending).toBe(sentinel);
    expect(nativeRequest).toHaveBeenCalledWith("screen");
    await fixture.player.exit();
    expect(sentinel.release).toHaveBeenCalledOnce();
    expect(fixture.wakeLock.request).toBe(nativeRequest);
  } finally {await fixture.player.exit();}
});

it("handles the native request rejection without hiding unrelated runtime errors", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<Sentinel>((_resolve, fail) => {reject = fail;});
  const observed = vi.spyOn(pending, "then");
  const fixture = await mount(vi.fn(() => pending));
  const native = nativeWakeLock(fixture.wakeLock);
  try {
    await native(true);
    // Check before rejecting: old code has no asynchronous failure observer.
    expect(observed.mock.calls.some(([, rejected]) => typeof rejected === "function")).toBe(true);
    reject(new DOMException("Wake Lock permission request denied", "NotAllowedError"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fixture.reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({code: "OPTIONAL_WAKE_LOCK_UNAVAILABLE"}));
    expect(fixture.player.getState()).toBe("RUNNING");
    await native(false);
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {value: new Error("unrelated engine failure")});
    fixture.realm.dispatchEvent(event);
    expect(fixture.player.getState()).toBe("FAILED");
  } finally {await fixture.player.exit();}
});

it("releases a grant arriving after exit without waiting for browser permission", async () => {
  let resolve!: (sentinel: Sentinel) => void;
  const pending = new Promise<Sentinel>(done => {resolve = done;});
  const request = vi.fn(() => pending), fixture = await mount(request);
  const sentinel = {released: false, release: vi.fn(async () => {})};
  const retained = fixture.wakeLock.request("screen");
  expect(retained).toBe(pending);
  await fixture.player.exit();
  expect(fixture.wakeLock.request).toBe(request);
  resolve(sentinel); await pending; await Promise.resolve();
  expect(sentinel.release).toHaveBeenCalledOnce();
  await fixture.player.exit();
  expect(sentinel.release).toHaveBeenCalledOnce();
});

it("tracks repeated native requests and does not release an already released sentinel twice", async () => {
  const sentinels = [0, 1].map(() => {
    const sentinel = {released: false, release: vi.fn(async () => {sentinel.released = true;})};
    return sentinel;
  });
  const request = vi.fn().mockResolvedValueOnce(sentinels[0]).mockResolvedValueOnce(sentinels[1]);
  const fixture = await mount(request), native = nativeWakeLock(fixture.wakeLock);
  try {
    await native(true); await native(true);
    expect(request).toHaveBeenCalledTimes(1);
    await native(false);
    await native(true); await Promise.resolve();
    await fixture.player.exit();
    expect(sentinels[0].release).toHaveBeenCalledOnce();
    expect(sentinels[1].release).toHaveBeenCalledOnce();
  } finally {await fixture.player.exit();}
});

it("contains optional release failure while completing exit", async () => {
  const fixture = await mount(vi.fn(async () => ({released: false, release: async () => {throw new Error("release denied");}})));
  await fixture.wakeLock.request("screen");
  await fixture.player.exit();
  expect(fixture.player.getState()).toBe("EXITED");
  expect(fixture.reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({code: "OPTIONAL_WAKE_LOCK_UNAVAILABLE"}));
});

type Sentinel = {release: () => Promise<void>; released: boolean};
// The pinned RetroArch enable path stores request(), and disable awaits it in
// try/catch before invoking release() without awaiting that result.
function nativeWakeLock(wakeLock: {request: (type: string) => Promise<Sentinel>}) {
  let pending: Promise<Sentinel> | null = null;
  return async (enabled: boolean) => {
    if (enabled && !pending) {
      try {pending = wakeLock.request("screen");} catch { /* optional native request */ }
    } else if (!enabled && pending) {
      try {const sentinel = await pending; void sentinel.release();} catch { /* native disable catches denied requests */ }
      pending = null;
    }
  };
}

async function mount(request: (type: string) => Promise<{release: () => Promise<void>; released: boolean}>) {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const realm = frame.contentWindow as Window & Record<string, unknown>;
  const wakeLock = {request};
  Object.defineProperty(realm.navigator, "wakeLock", {configurable: true, value: wakeLock});
  const reportDiagnostic = vi.fn();
  const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === "desmume")!;
  const envelope = launchEnvelope(); envelope.runtime.targetId = target.id;
  const player = await createEmulatorJsPlayer(envelope, hostFixture({reportDiagnostic,
    mountFrame: async () => ({contentWindow: realm, element: frame, origin: location.origin}),
  }), {[target.implementation.coreAssetPath]: {sha256: target.implementation.coreSha256, sizeBytes: target.implementation.coreSizeBytes}});
  const mounting = player.mount(document.createElement("div"));
  await vi.waitFor(() => expect(realm.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
  realm.EJS_emulator = {gameManager: {}};
  (realm.EJS_ready as () => void)(); (realm.EJS_onGameStart as () => void)();
  await mounting;
  return {player, realm, wakeLock, reportDiagnostic};
}
