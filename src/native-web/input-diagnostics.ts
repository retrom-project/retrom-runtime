import type {RuntimeInputDiagnosticsSnapshotV1, RuntimeInputDiagnosticsV1, RuntimeInputObservationV1} from "../provider/module-api.js";

const unavailable: RuntimeInputDiagnosticsSnapshotV1 = {
  events: [], held: [], dropped: 0, focus: "UNFOCUSED", keyboard: false, gamepad: false, delivery: false, coreRead: false,
};

export class NativeInputDiagnostics {
  private current: {snapshot: RuntimeInputDiagnosticsSnapshotV1} | null = null;
  constructor(private readonly request: (type: string, body: Record<string, unknown>) => Promise<unknown>) {}

  start(): RuntimeInputDiagnosticsV1 {
    this.stop();
    const current = {snapshot: unavailable};
    this.current = current;
    void this.request("INPUT_DIAGNOSTICS", {enabled: true}).catch(() => {current.snapshot = unavailable;});
    return {
      read: () => current.snapshot,
      clear: () => {void this.request("CLEAR_INPUT_DIAGNOSTICS", {}).catch(() => undefined);},
      stop: () => {if (this.current === current) {this.stop();}},
    };
  }

  update(value: unknown) {
    if (this.current && validSnapshot(value)) {this.current.snapshot = value;}
  }

  stop() {
    if (!this.current) {return;}
    this.current = null;
    void this.request("INPUT_DIAGNOSTICS", {enabled: false}).catch(() => undefined);
  }
}

export function validSnapshot(value: unknown): value is RuntimeInputDiagnosticsSnapshotV1 {
  if (!record(value)) {return false;}
  return value.coreRead === false && typeof value.keyboard === "boolean" && typeof value.gamepad === "boolean" &&
    typeof value.delivery === "boolean" && ["GAME", "OTHER", "UNFOCUSED"].includes(String(value.focus)) &&
    finite(value.dropped) && Array.isArray(value.events) && value.events.length <= 64 && value.events.every(validObservation) &&
    Array.isArray(value.held) && value.held.length <= 128 && value.held.every(validObservation);
}

function validObservation(value: unknown): value is RuntimeInputObservationV1 {
  if (!record(value)) {return false;}
  return finite(value.sequence) && finite(value.atMs) && typeof value.value === "number" && Number.isFinite(value.value) &&
    shortText(value.device) && shortText(value.control) && ["BROWSER", "RUNTIME", "DELIVERED"].includes(String(value.stage)) &&
    (value.target === null || shortText(value.target)) && (value.reason === null || shortText(value.reason)) &&
    (value.heldMs === null || finite(value.heldMs));
}
function finite(value: unknown) {return typeof value === "number" && Number.isFinite(value) && value >= 0;}
function shortText(value: unknown) {return typeof value === "string" && value.length <= 80;}
function record(value: unknown): value is Record<string, unknown> {return Boolean(value) && typeof value === "object" && !Array.isArray(value);}
