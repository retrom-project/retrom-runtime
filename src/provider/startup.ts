import type {RuntimeEventV1, RuntimeStartupKindV1, RuntimeStartupTaskV1} from "./module-api.js";

export type StartupTask = {
  progress(loadedBytes: number, totalBytes: number | null): void;
  complete(): void;
  fail(): void;
};
type TaskOptions = Pick<RuntimeStartupTaskV1, "summary">;

/** Only awaited operations complete tasks; counters never decide readiness. */
export class StartupTasks {
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<string, RuntimeStartupTaskV1>();
  private readonly preparations = new Map<RuntimeStartupKindV1, StartupTask>();
  constructor(private readonly emit: (event: RuntimeEventV1) => void, private readonly signal: AbortSignal) {}

  get active(): boolean {return !this.stopped && !this.signal.aborted;}

  begin(kind: RuntimeStartupKindV1, options: TaskOptions = {}): StartupTask {
    const id = `provider:${++this.sequence}`;
    const task: RuntimeStartupTaskV1 = {id, kind, state: "RUNNING", progress: null, ...(options.summary ? {summary: true} : {})};
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

  async run<T>(kind: RuntimeStartupKindV1, operation: (task: StartupTask) => Promise<T> | T, options?: TaskOptions): Promise<T> {
    const task = this.begin(kind, options);
    try {
      const value = await operation(task);
      task.complete();
      return value;
    } catch (error) {task.fail(); throw error;}
  }

  /** Indexed project reads form one startup phase, including gaps between requests. */
  async runPreparation<T>(kind: RuntimeStartupKindV1, operation: () => Promise<T>): Promise<T> {
    if (!this.active) {return operation();}
    let task = this.preparations.get(kind);
    if (!task) {task = this.begin(kind); this.preparations.set(kind, task);}
    try {return await operation();} catch (error) {task.fail(); throw error;}
  }

  /** Only adapter readiness closes the preparation phase; individual reads do not. */
  completePreparations(): void {
    for (const task of this.preparations.values()) {task.complete();}
    this.preparations.clear();
  }

  stop(failed = false): void {
    if (failed && !this.signal.aborted) {
      for (const task of this.pending.values()) {this.publish({...task, state: "FAILED"});}
    }
    this.pending.clear(); this.preparations.clear(); this.stopped = true;
  }

  private publish(task: RuntimeStartupTaskV1): void {
    this.emit({type: "LOAD_TASK", task: {...task, progress: task.progress ? {...task.progress} : null}});
  }
}

export function withStartupTask<T>(tasks: StartupTasks | undefined, kind: RuntimeStartupKindV1,
  operation: (task?: StartupTask) => Promise<T> | T, options?: TaskOptions): Promise<T> {
  return tasks ? tasks.run(kind, operation, options) : Promise.resolve(operation());
}
