import {abortError, checkSignal} from "./abort.js";
import {ContentIOError, fail, toContentIOError} from "./errors.js";
export type Priority = "FOREGROUND" | "MATERIALIZE" | "PREFETCH";
export type ScheduleOptions = {signal?: AbortSignal; timeoutMs?: number; priority?: Priority; whole?: boolean};
type Waiter<Value> = {deliver: (value: Value) => void; reject: (error: ContentIOError) => void; clean: () => void};
type Task<Value> = {key: string; priority: Priority; whole: boolean; controller: AbortController;
  run: (signal: AbortSignal) => Promise<Value>; waiters: Set<Waiter<Value>>; timer?: ReturnType<typeof setTimeout>};
/** A physical operation retains its slot until its abort cleanup has actually finished. */
export class BlockScheduler<Value> {
  private readonly tasks = new Map<string, Task<Value>>();
  private readonly queue: Task<Value>[] = [];
  private active = 0;
  private readonly running = new Set<Task<Value>>();
  private wholeActive = 0;
  private consecutiveForeground = 0;
  private closed = false;
  private readonly peak = {active: 0, queued: 0, pending: 0, waiters: 0};
  constructor(private readonly dispose: (value: Value) => void = () => {}) {}
  get stats() {return {active: this.active, queued: this.queue.length, pending: this.tasks.size,
    waiters: [...this.tasks.values()].reduce((sum, task) => sum + task.waiters.size, 0)};}
  has(key: string): boolean {return this.tasks.has(key);}
  /** Speculation is admitted immediately or skipped; it never fills the demand queue. */
  get canPrefetch(): boolean {
    return !this.closed && this.active < 4 && this.queue.length === 0 && !this.prefetchRunning;
  }
  private get prefetchRunning(): boolean {return [...this.running].some(task => task.priority === "PREFETCH");}
  get peaks() {return {...this.peak};}
  private recordPeak(): void {
    const current = this.stats;
    for (const key of ["active", "queued", "pending", "waiters"] as const) {this.peak[key] = Math.max(this.peak[key], current[key]);}
  }
  schedule(key: string, run: Task<Value>["run"], options: ScheduleOptions = {}): Promise<Value> {
    return this.consume(key, run, (value) => value, options);
  }
  /** consume runs synchronously before releasing the shared buffer; it must not retain it. */
  consume<Result>(key: string, run: Task<Value>["run"], consume: (value: Value) => Result, options: ScheduleOptions = {}): Promise<Result> {
    checkSignal(options.signal);
    if (this.closed) {fail("ABORTED");}
    const timeout = options.timeoutMs ?? (options.whole ? undefined : 15000);
    if (timeout !== undefined && (!(timeout > 0) || !Number.isFinite(timeout) || timeout > 15000)) {fail("TIMEOUT");}
    const priority = options.priority ?? "FOREGROUND";
    let task = this.tasks.get(key);
    if (!task) {
      if (this.queue.length >= 256) {fail("CAPACITY_EXCEEDED");}
      task = {key, run, priority, whole: options.whole ?? false,
        controller: new AbortController(), waiters: new Set()};
      this.tasks.set(key, task); this.queue.push(task);
    } else if (priority === "FOREGROUND" || priority === "MATERIALIZE" && task.priority === "PREFETCH") {task.priority = priority;}
    const shared = task;
    return new Promise<Result>((resolve, reject) => {
      const abort = () => this.cancel(shared, waiter, abortError(options.signal!));
      const timer = timeout === undefined ? undefined : setTimeout(() =>
        this.cancel(shared, waiter, new ContentIOError("TIMEOUT")), timeout);
      const waiter: Waiter<Value> = {deliver: (value) => {
        try {resolve(consume(value));} catch (error) {reject(toContentIOError(error));}
      }, reject, clean: () => {clearTimeout(timer); options.signal?.removeEventListener("abort", abort);}};
      shared.waiters.add(waiter);
      options.signal?.addEventListener("abort", abort, {once: true});
      this.dispatch(); this.recordPeak();
    });
  }
  close(reason = new ContentIOError("ABORTED")): void {
    this.closed = true;
    for (const task of this.tasks.values()) {this.cancelTask(task, reason);}
  }
  private cancelTask(task: Task<Value>, reason: ContentIOError) {
    for (const waiter of [...task.waiters]) {this.cancel(task, waiter, reason);}
  }
  private cancel(task: Task<Value>, waiter: Waiter<Value>, error: ContentIOError) {
    if (!task.waiters.delete(waiter)) {return;}
    waiter.clean(); waiter.reject(error);
    if (task.waiters.size === 0) {
      task.controller.abort(error);
      if (this.tasks.get(task.key) === task) {this.tasks.delete(task.key);}
      const index = this.queue.indexOf(task); if (index >= 0) {this.queue.splice(index, 1);}
    }
  }
  private dispatch(): void {
    while (!this.closed && this.active < 4) {
      const candidates = this.queue.filter((task) => !task.whole || this.wholeActive === 0);
      const foreground = candidates.find((task) => task.priority === "FOREGROUND");
      const background = candidates.find((task) => task.priority === "MATERIALIZE");
      const demand = foreground && (!background || this.consecutiveForeground < 8) ? foreground : background;
      const prefetch = !this.prefetchRunning && !this.queue.some(task => task.priority !== "PREFETCH") ?
        candidates.find(task => task.priority === "PREFETCH") : undefined;
      const task = demand ?? prefetch;
      if (!task) {return;}
      this.consecutiveForeground = task.priority === "FOREGROUND" ? Math.min(8, this.consecutiveForeground + 1) : 0;
      this.queue.splice(this.queue.indexOf(task), 1);
      this.active++; this.running.add(task); if (task.whole) {this.wholeActive++;}
      if (!task.whole) {task.timer = setTimeout(() => this.cancelTask(task, new ContentIOError("TIMEOUT")), 15000);}
      void this.run(task);
    }
  }
  private async run(task: Task<Value>): Promise<void> {
    let value: Value | undefined, acquired = false;
    try {
      value = await task.run(task.controller.signal); acquired = true;
      checkSignal(task.controller.signal);
      for (const waiter of task.waiters) {waiter.clean(); waiter.deliver(value);}
    } catch (error) {
      for (const waiter of task.waiters) {waiter.clean(); waiter.reject(toContentIOError(error));}
    } finally {
      if (acquired) {this.dispose(value as Value);}
      clearTimeout(task.timer); task.waiters.clear(); this.running.delete(task); this.active--; if (task.whole) {this.wholeActive--;}
      if (this.tasks.get(task.key) === task) {this.tasks.delete(task.key);}
      this.dispatch();
    }
  }
}
