import { describe, expect, it, vi } from "vitest";
import { NativeChannel, nativeBootstrapAction } from "./adapter";

describe("native RPG exit", () => {
  it("preempts an in-flight background status request so cleanup is sent immediately", async () => {
    let runtimePort: MessagePort | null = null;
    const channel = new NativeChannel({
      sessionId: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3",
      uniqueOrigin: "http://runtime.example",
      bootstrapUrl: "http://runtime.example/bootstrap",
      bootstrapTicket: "fixture-ticket",
      bridgeProfile: "RPGMV",
      cleanupUrl: "http://runtime.example/cleanup",
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
  it("connects when an authenticated bootstrap GET redirects directly to the bridge", () => {
    expect(nativeBootstrapAction("BOOTSTRAP", {
      type: "RPG_RUNTIME_NATIVE_BRIDGE_READY",
      protocolVersion: 1,
    })).toBe("CONNECT");
  });

  it("keeps the one-time ticket path for a first bootstrap", () => {
    const ready = { type: "RPG_RUNTIME_NATIVE_BOOTSTRAP_READY", protocolVersion: 1 };
    expect(nativeBootstrapAction("BOOTSTRAP", ready)).toBe("SEND_TICKET");
    expect(nativeBootstrapAction("BRIDGE", ready)).toBe("IGNORE");
    expect(nativeBootstrapAction("BRIDGE", {
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
      expect(nativeBootstrapAction("BOOTSTRAP", value)).toBe("IGNORE");
    }
  });
});
