import type {RuntimeEventV1, RuntimeStartupKindV1, RuntimeStartupTaskV1} from "./module-api.js";

export type StartupTask = {
  progress(loadedBytes: number, totalBytes: number | null): void;
  complete(): void;
  fail(): void;
};

/** Only awaited operations complete tasks; counters never decide readiness. */
export class StartupTasks {
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<string, RuntimeStartupTaskV1>();
  constructor(private readonly emit: (event: RuntimeEventV1) => void, private readonly signal: AbortSignal) {}

  get active(): boolean {return !this.stopped && !this.signal.aborted;}

  begin(kind: RuntimeStartupKindV1): StartupTask {
    const id = `provider:${++this.sequence}`;
    const task: RuntimeStartupTaskV1 = {id, kind, state: "RUNNING", progress: null};
    if (!this.stopped && !this.signal.aborted) {this.pending.set(id, task); this.publish(task);}
    const finish = (state: "COMPLETED" | "FAILED") => {
      if (!this.pending.delete(id)) {return;}
      task.state = state;
      if (!this.stopped && !this.signal.aborted) {this.publish(task);}
    };
    return {
      progress: (loadedBytes, totalBytes) => {
        if (!this.pending.has(id) || this.stopped || this.signal.aborted) {return;}
        if (totalBytes === null) {task.progress = null;}
        else if (Number.isSafeInteger(loadedBytes) && Number.isSafeInteger(totalBytes) && totalBytes > 0 && loadedBytes >= 0 && loadedBytes <= totalBytes) {
          task.progress = {loadedBytes, totalBytes};
        } else {return;}
        this.publish(task);
      },
      complete: () => finish("COMPLETED"), fail: () => finish("FAILED"),
    };
  }

  async run<T>(kind: RuntimeStartupKindV1, operation: (task: StartupTask) => Promise<T> | T): Promise<T> {
    const task = this.begin(kind);
    try {
      const value = await operation(task);
      task.complete();
      return value;
    } catch (error) {task.fail(); throw error;}
  }

  stop(failed = false): void {
    if (failed && !this.signal.aborted) {
      for (const task of this.pending.values()) {this.publish({...task, state: "FAILED"});}
    }
    this.pending.clear(); this.stopped = true;
  }

  private publish(task: RuntimeStartupTaskV1): void {
    this.emit({type: "LOAD_TASK", task: {...task, progress: task.progress ? {...task.progress} : null}});
  }
}

export function withStartupTask<T>(tasks: StartupTasks | undefined, kind: RuntimeStartupKindV1,
  operation: (task?: StartupTask) => Promise<T> | T): Promise<T> {
  return tasks ? tasks.run(kind, operation) : Promise.resolve(operation());
}
