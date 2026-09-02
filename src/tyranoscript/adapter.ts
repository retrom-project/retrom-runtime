import type { CheckpointAvailability } from "../contract.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter } from "../internal-adapter.js";
import type { TyranoScriptRuntimeConfig } from "./contract.js";

type Reply = {
  body: Record<string, unknown>;
  nonce: string;
  protocolVersion: number;
  requestId: number;
  sessionId: string;
  type: string;
};

type Pending = {
  reject: (error: Error) => void;
  resolve: (reply: Reply) => void;
  timer: number;
};

const protocolVersion = 1;
const bootstrapTimeoutMs = 15_000;
const readyTimeoutMs = 30_000;
const commandTimeoutMs = 30_000;
const maximumCheckpointBytes = 32 * 1024 * 1024;
const maximumScreenshotBytes = 2 * 1024 * 1024;

export async function mountTyranoScript(
  config: TyranoScriptRuntimeConfig,
  frame: HTMLIFrameElement,
  restorePayload: Uint8Array | null,
  reportExitRequested: RuntimeExitReporter = () => undefined,
): Promise<MountedRuntimeAdapter> {
  const channel = new TyranoScriptChannel(config, reportExitRequested);
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
  frame.referrerPolicy = "no-referrer";
  try {
    await bootstrapFrame(config, frame, channel);
    const ready = await channel.ready();
    if (ready.engine !== "TYRANOSCRIPT") {throw new Error("TYRANOSCRIPT_ENGINE_MISMATCH");}
    if (restorePayload) {await channel.restore(restorePayload);}
    channel.startProbeLoop();
  } catch (error) {
    channel.close();
    frame.src = "about:blank";
    throw stableError(error, "TYRANOSCRIPT_RUNTIME_FAILED");
  }

  return {
    checkpoint: async () => ({ bytes: await channel.checkpoint(), format: "tyranoscript-snapshot-v1" }),
    exit: async () => {
      channel.stopProbeLoop();
      await channel.request("CLEANUP", {}, 5_000).catch(() => undefined);
      await cleanup(config.adapter.cleanupUrl).catch(() => undefined);
      channel.close();
      frame.src = "about:blank";
    },
    getCanvas: () => null,
    getCheckpointAvailability: (): CheckpointAvailability => channel.checkpointAvailable()
      ? { available: true, blocker: null }
      : { available: false, blocker: "BUSY" },
    getFrameCount: () => channel.frames(),
    getValidationProbe: () => null,
    pause: async () => {await channel.request("PAUSE", {});},
    resume: async () => {await channel.request("RESUME", {});},
    screenshot: () => channel.screenshot(),
    setVolume: (value) => {void channel.request("SET_VOLUME", {value});},
  };
}

class TyranoScriptChannel {
  private readonly nonce = randomNonce();
  private readonly messageChannel = new MessageChannel();
  private connected = false;
  private closed = false;
  private lastRequestId = 0;
  private pending: Pending | null = null;
  private requestTail: Promise<void> = Promise.resolve();
  private readyValue: {checkpointAvailable: boolean; engine: string} | null = null;
  private readyWaiter: Pending | null = null;
  private available = false;
  private exitReported = false;
  private frameCount = 0;
  private probeTimer: number | null = null;

  constructor(
    private readonly config: TyranoScriptRuntimeConfig,
    private readonly reportExitRequested: RuntimeExitReporter,
  ) {
    this.messageChannel.port1.onmessage = (event) => this.receive(event.data);
    this.messageChannel.port1.start();
  }

  connect(target: Window) {
    if (this.connected || this.closed) {throw new Error("TYRANOSCRIPT_PROTOCOL_INVALID");}
    this.connected = true;
    target.postMessage({
      nonce: this.nonce,
      parentOrigin: window.location.origin,
      protocolVersion,
      sessionId: this.config.sessionId,
      type: "GAME_RUNTIME_TYRANOSCRIPT_CONNECT",
    }, this.config.adapter.uniqueOrigin, [this.messageChannel.port2]);
  }

  ready() {
    if (this.readyValue) {return Promise.resolve(this.readyValue);}
    return new Promise<{checkpointAvailable: boolean; engine: string}>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.readyWaiter = null;
        reject(new Error("TYRANOSCRIPT_RUNTIME_TIMEOUT"));
      }, readyTimeoutMs);
      this.readyWaiter = {
        reject,
        resolve: (reply) => resolve(readReady(reply.body)),
        timer,
      };
    });
  }

  request(type: string, body: Record<string, unknown>, timeoutMs = commandTimeoutMs) {
    if (!this.connected || this.closed) {return Promise.reject(new Error("TYRANOSCRIPT_CHANNEL_CLOSED"));}
    const operation = this.requestTail.then(() => this.sendRequest(type, body, timeoutMs));
    this.requestTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async checkpoint() {
    const reply = await this.request("CHECKPOINT", {});
    if (reply.type !== "CHECKPOINT_RESULT" || reply.body.format !== "tyranoscript-snapshot-v1") {
      throw new Error("TYRANOSCRIPT_CHECKPOINT_CREATE_FAILED");
    }
    return readBytes(reply.body.data, maximumCheckpointBytes, "TYRANOSCRIPT_CHECKPOINT_CREATE_FAILED");
  }

  async restore(payload: Uint8Array) {
    if (!payload.byteLength || payload.byteLength > maximumCheckpointBytes) {
      throw new Error("TYRANOSCRIPT_CHECKPOINT_RESTORE_FAILED");
    }
    const data = payload.slice().buffer;
    const reply = await this.request("RESTORE", {data});
    if (reply.type !== "RESTORE_RESULT" || Object.keys(reply.body).length !== 0) {
      throw new Error("TYRANOSCRIPT_CHECKPOINT_RESTORE_FAILED");
    }
  }

  async screenshot() {
    const reply = await this.request("SCREENSHOT", {});
    const mediaType = reply.body.mediaType;
    if (reply.type !== "SCREENSHOT_RESULT" || (mediaType !== "image/jpeg" && mediaType !== "image/png")) {
      throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");
    }
    const bytes = readBytes(reply.body.data, maximumScreenshotBytes, "PLAYER_SCREENSHOT_UNAVAILABLE");
    return new Blob([bytes], {type: mediaType});
  }

  checkpointAvailable() {return this.available && !this.closed;}
  frames() {return this.frameCount;}

  startProbeLoop() {
    const probe = async () => {
      try {
        const reply = await this.request("PROBE", {}, 5_000);
        if (reply.type === "PROBE_RESULT") {this.updateProbe(reply.body);}
      } catch { /* The next poll or the host exit path will settle the runtime. */ }
    };
    void probe();
    this.probeTimer = window.setInterval(() => {void probe();}, 250);
  }

  stopProbeLoop() {
    if (this.probeTimer !== null) {window.clearInterval(this.probeTimer);}
    this.probeTimer = null;
  }

  close() {
    if (this.closed) {return;}
    this.closed = true;
    this.available = false;
    this.stopProbeLoop();
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error("TYRANOSCRIPT_CHANNEL_CLOSED"));
      this.pending = null;
    }
    if (this.readyWaiter) {
      window.clearTimeout(this.readyWaiter.timer);
      this.readyWaiter.reject(new Error("TYRANOSCRIPT_CHANNEL_CLOSED"));
      this.readyWaiter = null;
    }
    this.messageChannel.port1.close();
  }

  private sendRequest(type: string, body: Record<string, unknown>, timeoutMs: number) {
    if (this.closed || this.pending) {return Promise.reject(new Error("TYRANOSCRIPT_PROTOCOL_INVALID"));}
    const requestId = ++this.lastRequestId;
    return new Promise<Reply>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending = null;
        reject(new Error("TYRANOSCRIPT_RUNTIME_TIMEOUT"));
      }, timeoutMs);
      this.pending = {reject, resolve, timer};
      this.messageChannel.port1.postMessage({
        body, nonce: this.nonce, protocolVersion, requestId, sessionId: this.config.sessionId, type,
      });
    });
  }

  private receive(value: unknown) {
    const reply = readReply(value, this.config.sessionId, this.nonce);
    if (!reply) {return;}
    if (reply.requestId === 0) {this.receiveEvent(reply); return;}
    if (!this.pending || reply.requestId !== this.lastRequestId) {return;}
    const pending = this.pending;
    this.pending = null;
    window.clearTimeout(pending.timer);
    if (reply.type === "ERROR") {
      pending.reject(new Error(typeof reply.body.code === "string" ? reply.body.code : "TYRANOSCRIPT_RUNTIME_FAILED"));
    } else {pending.resolve(reply);}
  }

  private receiveEvent(reply: Reply) {
    if (reply.type === "READY") {
      const ready = readReady(reply.body);
      this.readyValue = ready;
      this.available = ready.checkpointAvailable;
      if (this.readyWaiter) {
        const waiter = this.readyWaiter;
        this.readyWaiter = null;
        window.clearTimeout(waiter.timer);
        waiter.resolve(reply);
      }
    } else if (reply.type === "CHECKPOINT_AVAILABILITY" && ownKeys(reply.body, ["available"])) {
      this.available = reply.body.available === true;
    } else if (reply.type === "EXIT_REQUESTED" && Object.keys(reply.body).length === 0) {
      this.available = false;
      if (!this.exitReported) {
        this.exitReported = true;
        this.reportExitRequested();
      }
    }
  }

  private updateProbe(body: Record<string, unknown>) {
    if (!ownKeys(body, ["checkpointAvailable", "continuousFrames"]) ||
      typeof body.checkpointAvailable !== "boolean" || !Number.isSafeInteger(body.continuousFrames) ||
      Number(body.continuousFrames) < 0) {return;}
    this.available = body.checkpointAvailable;
    this.frameCount = Number(body.continuousFrames);
  }
}

async function bootstrapFrame(
  config: TyranoScriptRuntimeConfig,
  frame: HTMLIFrameElement,
  channel: TyranoScriptChannel,
) {
  const contentWindow = frame.contentWindow;
  if (!contentWindow) {throw new Error("PLAYER_FRAME_UNAVAILABLE");}
  const runtimeWindow: Window = contentWindow;
  let bootstrapTicket = config.adapter.bootstrapTicket;
  config.adapter.bootstrapTicket = "";
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("TYRANOSCRIPT_BOOTSTRAP_TIMEOUT")), bootstrapTimeoutMs);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      bootstrapTicket = "";
      window.removeEventListener("message", receive, true);
      if (error) {reject(error);} else {resolve();}
    }
    function receive(event: MessageEvent) {
      if (event.source !== runtimeWindow || event.origin !== config.adapter.uniqueOrigin ||
        !event.data || typeof event.data !== "object") {return;}
      if (bootstrapRequired(event.data)) {
        if (!bootstrapTicket) {finish(new Error("TYRANOSCRIPT_BOOTSTRAP_TIMEOUT")); return;}
        runtimeWindow.postMessage({
          protocolVersion, ticket: bootstrapTicket, type: "GAME_RUNTIME_TYRANOSCRIPT_BOOTSTRAP",
        }, config.adapter.uniqueOrigin);
        bootstrapTicket = "";
      } else if (bridgeReady(event.data)) {
        channel.connect(runtimeWindow);
        finish();
      }
    }
    window.addEventListener("message", receive, true);
    frame.src = config.adapter.entryUrl;
  });
}

function bootstrapRequired(value: Record<string, unknown>) {
  return ownKeys(value, ["protocolVersion", "type"]) && value.protocolVersion === protocolVersion &&
    value.type === "GAME_RUNTIME_TYRANOSCRIPT_BOOTSTRAP_REQUIRED";
}

function bridgeReady(value: Record<string, unknown>) {
  return ownKeys(value, ["protocolVersion", "type"]) && value.protocolVersion === protocolVersion &&
    value.type === "GAME_RUNTIME_TYRANOSCRIPT_BRIDGE_READY";
}

function readReply(value: unknown, sessionId: string, nonce: string): Reply | null {
  if (!ownKeys(value, ["body", "nonce", "protocolVersion", "requestId", "sessionId", "type"]) ||
    value.protocolVersion !== protocolVersion || value.sessionId !== sessionId || value.nonce !== nonce ||
    !Number.isSafeInteger(value.requestId) || Number(value.requestId) < 0 || typeof value.type !== "string" ||
    !value.body || typeof value.body !== "object" || Array.isArray(value.body)) {return null;}
  return value as Reply;
}

function readReady(body: Record<string, unknown>) {
  if (!ownKeys(body, ["checkpointAvailable", "engine"]) || body.engine !== "TYRANOSCRIPT" ||
    typeof body.checkpointAvailable !== "boolean") {throw new Error("TYRANOSCRIPT_PROTOCOL_INVALID");}
  return {checkpointAvailable: body.checkpointAvailable, engine: body.engine};
}

function readBytes(value: unknown, maximum: number, code: string) {
  if (!(value instanceof ArrayBuffer) || !value.byteLength || value.byteLength > maximum) {throw new Error(code);}
  return new Uint8Array(value).slice();
}

function ownKeys(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {return false;}
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function stableError(error: unknown, fallback: string) {
  return error instanceof Error && /^TYRANOSCRIPT_[A-Z0-9_]+$/u.test(error.message) ? error : new Error(fallback);
}

async function cleanup(value: string | null) {
  if (!value) {return;}
  await fetch(value, {credentials: "include", method: "POST"});
}
