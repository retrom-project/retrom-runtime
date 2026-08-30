import { afterEach, describe, expect, it, vi } from "vitest";

import { mountTyranoScript } from "./adapter.js";
import type { TyranoScriptRuntimeConfig } from "./contract.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("TyranoScript isolated Web adapter", () => {
  it("bootstraps once, restores, checkpoints, screenshots and reports a game-owned exit once", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    const fetchMock = vi.fn(async () => new Response(null, {status: 204}));
    vi.stubGlobal("fetch", fetchMock);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow;
    if (!runtimeWindow) {throw new Error("test iframe unavailable");}
    const commands: string[] = [];
    const hostMessages: unknown[] = [];
    let runtimePort: FakePort | null = null;
    vi.spyOn(runtimeWindow, "postMessage").mockImplementation(((message: unknown, _origin?: string, transfer?: Transferable[]) => {
      hostMessages.push(message);
      if ((message as {type?: string}).type !== "GAME_RUNTIME_TYRANOSCRIPT_CONNECT") {return;}
      const connect = message as ConnectEnvelope;
      runtimePort = transfer?.[0] as unknown as FakePort;
      runtimePort.onmessage = (event) => {
        const request = event.data as RequestEnvelope;
        commands.push(request.type);
        const result = commandResult(request);
        runtimePort?.postMessage(result);
      };
      runtimePort.start();
      queueMicrotask(() => runtimePort?.postMessage(eventEnvelope(connect, "READY", {
        checkpointAvailable: true, engine: "TYRANOSCRIPT",
      })));
    }) as typeof runtimeWindow.postMessage);
    const exits = vi.fn();
    const config = runtimeConfig();
    const mounting = mountTyranoScript(config, frame, Uint8Array.of(1, 2, 3), exits);

    dispatchRuntimeMessage(runtimeWindow, {
      protocolVersion: 1, type: "GAME_RUNTIME_TYRANOSCRIPT_BOOTSTRAP_REQUIRED",
    });
    expect(hostMessages).toContainEqual({
      protocolVersion: 1,
      ticket: "one-time-ticket",
      type: "GAME_RUNTIME_TYRANOSCRIPT_BOOTSTRAP",
    });
    dispatchRuntimeMessage(runtimeWindow, {
      protocolVersion: 1, type: "GAME_RUNTIME_TYRANOSCRIPT_BRIDGE_READY",
    });
    const adapter = await mounting;

    expect(config.adapter.bootstrapTicket).toBe("");
    expect(commands).toContain("RESTORE");
    expect(adapter.getCheckpointAvailability()).toEqual({available: true, blocker: null});
    await expect(adapter.checkpoint()).resolves.toEqual({
      bytes: Uint8Array.of(123, 34, 115, 99, 104, 101, 109, 97, 86, 101, 114, 115, 105, 111, 110, 34, 58, 49, 125),
      format: "tyranoscript-snapshot-v1",
    });
    await expect(adapter.screenshot()).resolves.toEqual(expect.objectContaining({size: 4, type: "image/jpeg"}));
    await adapter.pause();
    await adapter.resume();
    adapter.setVolume?.(0.5);
    await vi.waitFor(() => expect(commands).toContain("SET_VOLUME"));

    const connect = hostMessages.find((value) => (value as {type?: string}).type ===
      "GAME_RUNTIME_TYRANOSCRIPT_CONNECT") as ConnectEnvelope;
    const activeRuntimePort = runtimePort as FakePort | null;
    if (!activeRuntimePort) {throw new Error("test runtime port unavailable");}
    activeRuntimePort.postMessage(eventEnvelope(connect, "EXIT_REQUESTED", {}));
    activeRuntimePort.postMessage(eventEnvelope(connect, "EXIT_REQUESTED", {}));
    await vi.waitFor(() => expect(exits).toHaveBeenCalledTimes(1));
    expect(adapter.getCheckpointAvailability()).toEqual({available: false, blocker: "BUSY"});

    await adapter.exit();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example/runtime/cleanup",
      {credentials: "include", method: "POST"},
    );
    expect(frame.src).toBe("about:blank");
  });

  it("connects directly when an existing isolated capability redirects to the bridge", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 204})));
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow;
    if (!runtimeWindow) {throw new Error("test iframe unavailable");}
    vi.spyOn(runtimeWindow, "postMessage").mockImplementation(((message: unknown, _origin?: string, transfer?: Transferable[]) => {
      if ((message as {type?: string}).type !== "GAME_RUNTIME_TYRANOSCRIPT_CONNECT") {return;}
      const connect = message as ConnectEnvelope;
      const port = transfer?.[0] as unknown as FakePort;
      port.onmessage = (event) => {
        const request = event.data as RequestEnvelope;
        port.postMessage(commandResult(request));
      };
      port.start();
      queueMicrotask(() => port.postMessage(eventEnvelope(connect, "READY", {
        checkpointAvailable: true, engine: "TYRANOSCRIPT",
      })));
    }) as typeof runtimeWindow.postMessage);
    const mounting = mountTyranoScript(runtimeConfig(), frame, null);

    dispatchRuntimeMessage(runtimeWindow, {
      protocolVersion: 1, type: "GAME_RUNTIME_TYRANOSCRIPT_BRIDGE_READY",
    });
    const adapter = await mounting;
    await adapter.exit();
  });
});

type ConnectEnvelope = {
  nonce: string;
  protocolVersion: number;
  sessionId: string;
};

type RequestEnvelope = ConnectEnvelope & {
  body: Record<string, unknown>;
  requestId: number;
  type: string;
};

function eventEnvelope(connect: ConnectEnvelope, type: string, body: Record<string, unknown>) {
  return {
    body, nonce: connect.nonce, protocolVersion: 1, requestId: 0, sessionId: connect.sessionId, type,
  };
}

function commandResult(request: RequestEnvelope) {
  const bodies: Record<string, Record<string, unknown>> = {
    CHECKPOINT: {
      data: Uint8Array.of(123, 34, 115, 99, 104, 101, 109, 97, 86, 101, 114, 115, 105, 111, 110, 34, 58, 49, 125).buffer,
      format: "tyranoscript-snapshot-v1",
    },
    PROBE: {checkpointAvailable: true, continuousFrames: 320},
    SCREENSHOT: {data: Uint8Array.of(255, 216, 255, 217).buffer, mediaType: "image/jpeg"},
  };
  const types: Record<string, string> = {
    CHECKPOINT: "CHECKPOINT_RESULT", CLEANUP: "CLEANUP_RESULT", PAUSE: "PAUSE_RESULT",
    PROBE: "PROBE_RESULT", RESTORE: "RESTORE_RESULT", RESUME: "RESUME_RESULT",
    SCREENSHOT: "SCREENSHOT_RESULT", SET_VOLUME: "SET_VOLUME_RESULT",
  };
  return {
    body: bodies[request.type] ?? {}, nonce: request.nonce, protocolVersion: 1,
    requestId: request.requestId, sessionId: request.sessionId, type: types[request.type],
  };
}

function dispatchRuntimeMessage(source: Window, data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", {
    data, origin: "https://runtime.example", source,
  }));
}

function runtimeConfig(): TyranoScriptRuntimeConfig {
  return {
    adapter: {
      adapterId: "tyranoscript-web",
      adapterKind: "TYRANOSCRIPT_WEB",
      bootstrapTicket: "one-time-ticket",
      cleanupUrl: "https://runtime.example/runtime/cleanup",
      entryUrl: "https://runtime.example/runtime/entry",
      uniqueOrigin: "https://runtime.example",
    },
    contentDigest: "a".repeat(64),
    sessionId: "01990000-0000-7000-8000-000000000001",
  };
}

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  peer: FakePort | null = null;
  closed = false;

  postMessage(value: unknown) {
    const peer = this.peer;
    if (!this.closed && peer && !peer.closed) {queueMicrotask(() => peer.onmessage?.({data: value} as MessageEvent));}
  }
  start() {}
  close() {this.closed = true;}
}

class FakeMessageChannel {
  readonly port1 = new FakePort();
  readonly port2 = new FakePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}
