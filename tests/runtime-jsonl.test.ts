// @vitest-environment node
import {expect, it} from "vitest";
import {PassThrough} from "node:stream";
import {setTimeout} from "node:timers/promises";
import {serveJSONL} from "../scripts/runtime-jsonl.mjs";

it("correlates concurrent replies, cancels one request and retains bounded admission", async () => {
  const input = new PassThrough(), output = new PassThrough();
  let active = 0, peak = 0;
  const lines: string[] = [];
  output.on("data", chunk => lines.push(chunk.toString()));
  const serving = serveJSONL(async (_command, value, signal) => {
    active++; peak = Math.max(peak, active);
    try {await setTimeout(value.delay as number, undefined, {signal}); return value.value;}
    finally {active--;}
  }, {input, output, concurrency: 2, capacity: 3});
  const send = (id: string, delay: number, value: string) => input.write(JSON.stringify({id, command: "test", input: {delay, value}}) + "\n");
  send("slow", 200, "slow"); send("fast", 10, "fast"); send("queued", 20, "queued"); send("overflow", 1, "overflow");
  await setTimeout(35);
  input.write(JSON.stringify({cancel: "slow"}) + "\n");
  input.end(); await serving;
  const replies = lines.join("").trim().split("\n").map(line => JSON.parse(line));
  expect(replies.find(reply => reply.id === "overflow")).toEqual({id: "overflow", error: "RUNTIME_BUSY"});
  expect(replies.filter(reply => reply.result).map(reply => reply.id)).toEqual(["fast", "queued"]);
  expect(replies.find(reply => reply.id === "slow")).toEqual({id: "slow", error: "RUNTIME_CANCELLED"});
  expect(peak).toBe(2); expect(active).toBe(0);
});

it("cancels a queued request without executing it and rejects duplicate active IDs", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const executed: string[] = [], lines: string[] = [];
  output.on("data", chunk => lines.push(chunk.toString()));
  const serving = serveJSONL(async (_command, value) => {
    executed.push(value.value as string); await setTimeout(40); return value.value;
  }, {input, output, concurrency: 1, capacity: 3});
  input.end([
    {id: "one", command: "test", input: {value: "one"}},
    {id: "two", command: "test", input: {value: "two"}},
    {cancel: "two"},
    {id: "one", command: "test", input: {value: "duplicate"}},
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  await serving;
  expect(executed).toEqual(["one"]);
  expect(lines.join("")).toContain('"RUNTIME_REQUEST_INVALID"');
  expect(lines.join("")).toContain('"RUNTIME_CANCELLED"');
});
