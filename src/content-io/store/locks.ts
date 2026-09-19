import {abortable, checkSignal, requestScope} from "../abort.js";
import {namespace} from "./types.js";
export class ContentLocks {
  constructor(private readonly locks: LockManager = navigator.locks) {}
  async use(key: string, signal?: AbortSignal): Promise<() => void> {
    checkSignal(signal);
    let acquired!: (release: () => void) => void, rejected!: (error: unknown) => void;
    const ready = new Promise<() => void>((resolve, reject) => {acquired = resolve; rejected = reject;});
    const held = this.locks.request(`${namespace}:use:${key}`, {mode: "shared", signal}, async () => {
      await new Promise<void>((resolve) => {acquired(resolve);});
    });
    void held.catch(rejected);
    // No race here: queued lock cancellation is delegated to the native request signal.
    return ready;
  }
  async data<Value>(key: string, signal: AbortSignal | undefined, action: () => Promise<Value>): Promise<Value> {
    checkSignal(signal);
    return this.locks.request(`${namespace}:data:${key}`, {mode: "exclusive", signal}, async () => {checkSignal(signal); return action();});
  }
  async gc<Value>(key: string, action: () => Promise<Value>): Promise<Value | undefined> {
    return await this.locks.request(`${namespace}:use:${key}`, {mode: "exclusive", ifAvailable: true}, async (lock) => lock ? action() : undefined);
  }
  async probe(signal?: AbortSignal): Promise<void> {
    const scope = requestScope(signal, 2000);
    try {await abortable(this.locks.request(`${namespace}:probe:${crypto.randomUUID()}`, {signal: scope.signal}, () => {}), scope.signal);}
    finally {scope.dispose();}
  }
}
