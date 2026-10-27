import { describe, expect, it, vi } from "vitest";
import { NativeChannel, nativeBootstrapAction, mountNativeRpg } from "./adapter";

it("applies the initial MZ touch preference and toggles the same isolated input bridge", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  vi.spyOn(NativeChannel.prototype, "connect").mockImplementation(() => undefined);
  vi.spyOn(NativeChannel.prototype, "ready").mockResolvedValue({engine: "RPGMZ", engineProfile: "RPGMZ"});
  vi.spyOn(NativeChannel.prototype, "startStatusLoop").mockImplementation(() => undefined);
  const request = vi.spyOn(NativeChannel.prototype, "request").mockImplementation(async type => ({
    type: `${type}_RESULT`, body: {}, launchId: "fixture", nonce: "fixture", protocolVersion: 1, requestId: 1,
  }));
  const mounting = mountNativeRpg({sessionId: "fixture", uniqueOrigin: window.location.origin, bridgeProfile: "RPGMZ"},
    frame, null, () => undefined, {touchGamepadEnabled: false});
  window.dispatchEvent(new MessageEvent("message", {source: frame.contentWindow, origin: window.location.origin,
    data: {type: "RPG_RUNTIME_NATIVE_BRIDGE_READY", protocolVersion: 1}}));
  const adapter = await mounting;
  try {
    const controls = adapter.getTouchGamepad();
    expect(controls?.getState()).toEqual({enabled: false});
    expect(request).toHaveBeenCalledWith("SET_TOUCH_GAMEPAD", {enabled: false});
    await controls!.setEnabled(true);
    expect(request).toHaveBeenLastCalledWith("SET_TOUCH_GAMEPAD", {enabled: true});
    expect(controls!.getState()).toEqual({enabled: true});
  } finally {await adapter.exit(); frame.remove(); vi.restoreAllMocks();}
});

describe("native RPG exit", () => {
  it("preempts an in-flight background status request so cleanup is sent immediately", async () => {
    let runtimePort: MessagePort | null = null;
    const channel = new NativeChannel({
      sessionId: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3",
      uniqueOrigin: "http://runtime.example",
      bridgeProfile: "RPGMV",
    }, () => undefined);
    channel.connect({
      postMessage: (_message: unknown, _origin: string, transfer: Transferable[]) => {
        runtimePort = transfer[0] as MessagePort;
      },
    } as unknown as Window);
    const sent: Array<Record<string, unknown>> = [];
    const port = runtimePort as unknown as MessagePort;
    port.onmessage = (event) => {sent.push(event.data as Record<string, unknown>);};
    port.start();

    channel.startStatusLoop();
    await vi.waitFor(() => expect(sent.some((message) => message.type === "STATUS")).toBe(true));

    channel.prepareCleanup();
    const cleanup = channel.request("CLEANUP", {}, 1_000);
    await vi.waitFor(() => expect(sent.some((message) => message.type === "CLEANUP")).toBe(true));
    const request = sent.find((message) => message.type === "CLEANUP")!;
    port.postMessage({...request, type: "CLEANUP_RESULT"});

    await cleanup;
    channel.close();
    port.close();
  });
});

describe("native RPG bootstrap reload", () => {
  it("keeps the host's isolated shell navigation while waiting for the game bridge", async () => {
    const frame = document.createElement("iframe");
    frame.src = "http://runtime.example/host-shell.html";
    document.body.append(frame);
    const shell = frame.src, controller = new AbortController();
    const mounting = mountNativeRpg({sessionId: "run", bridgeProfile: "RPGMV", uniqueOrigin: "http://runtime.example"},
      frame, null, () => undefined, {signal: controller.signal});
    try {
      expect(frame.src).toBe(shell);
      expect(frame.getAttribute("sandbox")?.split(/\s+/u)).toContain("allow-modals");
    }
    finally {controller.abort(); await expect(mounting).rejects.toMatchObject({name: "AbortError"}); frame.remove();}
  });
  it("connects when the isolated game bridge is ready", () => {
    expect(nativeBootstrapAction( {
      type: "RPG_RUNTIME_NATIVE_BRIDGE_READY",
      protocolVersion: 1,
    })).toBe("CONNECT");
  });

  it("rejects wrong versions, extra fields, arrays and unknown messages", () => {
    for (const value of [
      { type: "RPG_RUNTIME_NATIVE_BRIDGE_READY", protocolVersion: 2 },
      { type: "RPG_RUNTIME_NATIVE_BRIDGE_READY", protocolVersion: 1, launchId: "unexpected" },
      { type: "UNKNOWN", protocolVersion: 1 },
      ["RPG_RUNTIME_NATIVE_BRIDGE_READY", 1],
      null,
    ]) {
      expect(nativeBootstrapAction( value)).toBe("IGNORE");
    }
  });
});

it("accepts shortcut events only from the current private channel identity and stops after close", async () => {
  const report = vi.fn();
  const channel = new NativeChannel({sessionId: "session", uniqueOrigin: "https://runtime.example", bridgeProfile: "RPGMV"}, () => undefined);
  channel.reportHostShortcut = report;
  let port: MessagePort | null = null;
  let identity: Record<string, unknown> = {};
  channel.connect({postMessage: (message: Record<string, unknown>, _origin: string, transfer: Transferable[]) => {
    port = transfer[0] as MessagePort;
    identity = {launchId: message.launchId, nonce: message.nonce, protocolVersion: message.protocolVersion};
  }} as unknown as Window);
  const runtimePort = port as unknown as MessagePort;
  const event = {...identity, requestId: 0, type: "HOST_SHORTCUT", body: {shortcut: "MENU"}};
  for (const message of [{...event, nonce: "foreign"}, {...event, launchId: "foreign"},
    {...event, body: {shortcut: "UNKNOWN"}}, {...event, body: {shortcut: "MENU", extra: true}}]) {
    runtimePort.postMessage(message);
  }
  runtimePort.postMessage(event);
  await vi.waitFor(() => expect(report).toHaveBeenCalledExactlyOnceWith("MENU"));
  channel.close(); runtimePort.postMessage(event);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(report).toHaveBeenCalledOnce(); runtimePort.close();
});
