import type {RuntimeInputObservationV1} from "./module-api.js";

type Observation = Omit<RuntimeInputObservationV1, "sequence" | "heldMs" | "atMs">;
export class InputObservations {
  private sequence = 0;
  private events: RuntimeInputObservationV1[] = [];
  private active = new Map<string, RuntimeInputObservationV1>();
  private values = new Map<string, number>();
  dropped = 0;

  record(input: Observation, atMs: number) {
    const key = `${input.stage}:${input.device}:${input.control}:${input.target ?? ""}`;
    if (this.values.get(key) === input.value || !this.values.has(key) && input.value === 0) {return;}
    // Only retain active controls; a disconnected device cannot grow this map forever.
    if (input.value === 0) {this.values.delete(key);} else if (this.values.size < 256) {this.values.set(key, input.value);}
    else {this.dropped++; return;}
    const previous = this.active.get(key);
    const event = {...input, sequence: ++this.sequence, atMs, heldMs: input.value === 0 && previous ? atMs - previous.atMs : null};
    if (input.value === 0) {this.active.delete(key);} else {this.active.set(key, {...event, atMs: previous?.atMs ?? atMs});}
    this.events.push(event);
    if (this.events.length > 64) {this.events.shift(); this.dropped++;}
  }

  releaseDevice(device: string) {
    for (const [key, event] of this.active) {
      if (event.device === device) {this.active.delete(key); this.values.delete(key);}
    }
  }

  resetHeld() {this.active.clear(); this.values.clear();}
  clear() {this.events = []; this.dropped = 0;}
  read() {return {events: this.events.map((event) => ({...event})), held: [...this.active.values()].map((event) => ({...event})), dropped: this.dropped};}
}

const observers = new WeakMap<Window, InputObservations>();
export function inputObserver(window: Window) {return observers.get(window);}
export function registerInputObserver(window: Window, observations: InputObservations) {
  observers.set(window, observations);
  return () => {if (observers.get(window) === observations) {observers.delete(window);}};
}
