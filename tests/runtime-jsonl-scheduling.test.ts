// @vitest-environment node
import {expect, it, vi} from "vitest";
import {PassThrough, Writable} from "node:stream";
import {serveJSONL} from "../scripts/runtime-jsonl.mjs";

// Control the system clock at the imported Node timer boundary as well as globals.
vi.mock("node:timers", () => ({
  setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timer: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(timer),
}));

it("keeps four interactive executions available while normalization has two running and four waiting", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const started: string[] = [], finish: Array<() => void> = [], replies: string[] = [];
  output.on("data", chunk => replies.push(chunk.toString()));
  const serving = serveJSONL(async (command, value) => {
    started.push(`${command}:${value.value}`);
    await new Promise<void>(resolve => finish.push(resolve));
    return value.value;
  }, {input, output});
  const send = (id: string, command: string) => input.write(JSON.stringify({id, command, input: {value: id}}) + "\n");
  try {
    for (let i = 0; i < 6; i++) send(`normalize-${i}`, "normalize-content");
    for (let i = 0; i < 4; i++) send(`interactive-${i}`, i % 2 ? "prepare" : "configure");
    send("normalize-overflow", "normalize-content");
    await vi.waitFor(() => {
      expect(started.filter(value => value.startsWith("normalize-content:"))).toHaveLength(2);
      expect(started.filter(value => /^(?:prepare|configure):/u.test(value))).toHaveLength(4);
      expect(replies.join("")).toContain('"id":"normalize-overflow","error":"RUNTIME_BUSY"');
    }, {timeout: 500});
  } finally {
    // Release every execution, including newly dispatched queued work, before EOF.
    for (let i = 0; i < 12; i++) {
      for (const resolve of finish.splice(0)) resolve();
      await new Promise(resolve => setImmediate(resolve));
    }
    input.end(); await serving;
  }
  expect(started.filter(value => value.startsWith("normalize-content:"))).toEqual(
    Array.from({length: 6}, (_, i) => `normalize-content:normalize-${i}`));
});

function schedulingFixture(options: NonNullable<Parameters<typeof serveJSONL>[1]> = {}) {
  const input = new PassThrough(), output = new PassThrough();
  const started: string[] = [], aborted: string[] = [], lines: string[] = [], completions = new Map<string, () => void>();
  output.on("data", chunk => lines.push(chunk.toString()));
  const finished = serveJSONL(async (_command, value, signal) => {
    const id = value.value as string;
    started.push(id); signal.addEventListener("abort", () => aborted.push(id), {once: true});
    await new Promise<void>(resolve => completions.set(id, resolve));
    return id;
  }, {input, output, ...options}).then(() => null, (error: Error) => error);
  return {
    input, output, started, aborted, finished,
    send(id: string, command = "normalize-content", extra = {}) {
      input.write(JSON.stringify({id, command, input: {value: id, ...extra}}) + "\n");
    },
    cancel(id: string) {input.write(JSON.stringify({cancel: id}) + "\n");},
    replies() {return lines.join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));},
    release(id: string) {completions.get(id)?.(); completions.delete(id);},
    async close() {
      for (let i = 0; i < 12; i++) {
        for (const resolve of completions.values()) resolve();
        completions.clear();
        await new Promise(resolve => setImmediate(resolve));
      }
      input.end(); expect(await finished).toBeNull();
    },
  };
}

it("has separate JSON input byte quotas and returns normalization bytes after completion", async () => {
  const fixture = schedulingFixture({inputCapacity: 256, normalizationInputCapacity: 256});
  try {
    fixture.send("one", "normalize-content", {padding: "x".repeat(100)});
    fixture.send("full", "normalize-content", {padding: "x".repeat(100)});
    fixture.send("interactive", "prepare", {padding: "x".repeat(100)});
    await vi.waitFor(() => {
      expect(fixture.started).toEqual(["one", "interactive"]);
      expect(fixture.replies()).toContainEqual({id: "full", error: "RUNTIME_BUSY"});
    });
    fixture.release("one");
    await vi.waitFor(() => expect(fixture.replies()).toContainEqual({id: "one", result: "one"}));
    fixture.send("next", "normalize-content", {padding: "x".repeat(100)});
    await vi.waitFor(() => expect(fixture.started).toContain("next"));
  } finally {await fixture.close();}
});

it("removes cancelled queued work, preserves FIFO, and holds running cancellation until cleanup", async () => {
  const fixture = schedulingFixture({normalizationConcurrency: 1, normalizationCapacity: 3});
  try {
    fixture.send("running"); fixture.send("cancel-queued"); fixture.send("next");
    await vi.waitFor(() => expect(fixture.started).toEqual(["running"]));
    fixture.cancel("cancel-queued");
    await vi.waitFor(() => expect(fixture.replies()).toContainEqual({id: "cancel-queued", error: "RUNTIME_CANCELLED"}));
    fixture.send("last"); fixture.cancel("running"); fixture.send("overflow");
    await vi.waitFor(() => {
      expect(fixture.aborted).toEqual(["running"]);
      expect(fixture.replies()).toContainEqual({id: "overflow", error: "RUNTIME_BUSY"});
      expect(fixture.started).toEqual(["running"]);
    });
    fixture.release("running");
    await vi.waitFor(() => expect(fixture.started).toEqual(["running", "next"]));
    fixture.release("next");
    await vi.waitFor(() => expect(fixture.started).toEqual(["running", "next", "last"]));
    expect(fixture.replies()).toContainEqual({id: "running", error: "RUNTIME_CANCELLED"});
  } finally {await fixture.close();}
});

it("starts the normalization deadline at admission and expires queued work without execution", async () => {
  vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
  const fixture = schedulingFixture({normalizationConcurrency: 1, normalizationCapacity: 3});
  try {
    fixture.send("running"); fixture.send("expired-queued");
    await new Promise(resolve => setImmediate(resolve));
    expect(fixture.started).toEqual(["running"]);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fixture.aborted).toEqual(["running"]);
    expect(fixture.replies()).toContainEqual({id: "expired-queued", error: "RUNTIME_CANCELLED"});
    expect(fixture.started).toEqual(["running"]);
    fixture.send("after-deadline");
    await new Promise(resolve => setImmediate(resolve));
    expect(fixture.started).toEqual(["running"]);
    fixture.release("running");
    await new Promise(resolve => setImmediate(resolve));
    expect(fixture.started).toEqual(["running", "after-deadline"]);
  } finally {
    await fixture.close(); vi.useRealTimers();
  }
});

it("aborts active and queued work when a backpressured output transport closes", async () => {
  const input = new PassThrough(), started: string[] = [], aborted: string[] = [];
  let writes = 0;
  const output = new Writable({highWaterMark: 1, write() {writes++;}});
  const finished = serveJSONL(async (command, value, signal) => {
    const id = value.value as string; started.push(id);
    if (command === "normalize-content") {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => {aborted.push(id); resolve();}, {once: true}));
    }
    return id;
  }, {input, output}).then(() => null, (error: Error) => error);
  for (let i = 0; i < 6; i++) input.write(JSON.stringify({id: `n${i}`, command: "normalize-content", input: {value: `n${i}`}}) + "\n");
  input.write(JSON.stringify({id: "interactive", command: "prepare", input: {value: "interactive"}}) + "\n");
  try {
    await vi.waitFor(() => expect(writes).toBe(1));
    output.destroy();
    expect((await finished)?.message).toBe("RUNTIME_OUTPUT_CLOSED");
    expect(started).toEqual(["n0", "n1", "interactive"]);
    expect(aborted).toEqual(["n0", "n1"]);
  } finally {input.destroy(); output.destroy();}
});

it("aborts both lanes and discards queued requests on an input transport failure", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const started: string[] = [], aborted: string[] = [];
  output.on("data", () => {});
  const finished = serveJSONL(async (_command, value, signal) => {
    const id = value.value as string; started.push(id);
    await new Promise<void>(resolve => signal.addEventListener("abort", () => {aborted.push(id); resolve();}, {once: true}));
    return id;
  }, {input, output}).then(() => null, (error: Error) => error);
  for (let i = 0; i < 6; i++) input.write(JSON.stringify({id: `n${i}`, command: "normalize-content", input: {value: `n${i}`}}) + "\n");
  input.write(JSON.stringify({id: "interactive", command: "configure", input: {value: "interactive"}}) + "\n");
  await vi.waitFor(() => expect(started).toEqual(["n0", "n1", "interactive"]));
  input.destroy(new Error("broken input"));
  expect((await finished)?.message).toBe("broken input");
  expect(aborted).toEqual(["n0", "n1", "interactive"]);
});
