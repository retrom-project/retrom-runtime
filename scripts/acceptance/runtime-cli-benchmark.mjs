import {spawn, execFile} from "node:child_process";
import {createInterface} from "node:readline";
import {writeFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {resolve} from "node:path";

const [toolRoot, output] = process.argv.slice(2).map(path => resolve(path));
if (!toolRoot || !output) {throw new Error("BENCHMARK_INPUT_INVALID");}
const cli = resolve(toolRoot, "scripts/runtime-cli.mjs");
const files = [{logicalKey: "game.nes", name: "game.nes", sha256: "a".repeat(64), sizeBytes: 1}];
const input = {platformId: "nes", coreIds: ["fceumm"], files};
const cold = [];
for (let index = 0; index < 12; index++) {
  const start = performance.now();
  const child = execFile(process.execPath, [cli, "configure"], {cwd: "/tmp"});
  await new Promise((yes, no) => {
    let data = ""; child.stdout.on("data", bytes => {data += bytes;});
    child.on("error", no); child.on("close", code => {
      try {if (code) {throw new Error(data);} JSON.parse(data); yes();} catch (error) {no(error);}
    });
    child.stdin.end(JSON.stringify(input));
  });
  cold.push(performance.now() - start);
}
const child = spawn(process.execPath, [cli, "--serve"], {cwd: "/tmp"});
const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
const warm = []; let config;
try {
  for (let index = 0; index < 101; index++) {
    const start = performance.now(), row = await call(index, "configure", input);
    config = row; if (index) {warm.push(performance.now() - start);}
  }
  const directory = {platformId: "nes", defaultCoreId: "fceumm", allowedCoreIds: ["fceumm"]};
  const batch = {items: Array.from({length: 200}, () => ({directory, config, files,
    fingerprints: {"emulatorjs/fceumm": "b".repeat(64)}}))};
  const batches = [];
  for (let index = 0; index < 20; index++) {
    const start = performance.now(), rows = await call(`batch${index}`, "batch-identity", batch);
    if (rows.length !== 200 || rows.some(row => row.error)) {throw new Error("BENCHMARK_BATCH_FAILED");}
    batches.push(performance.now() - start);
  }
  const result = {node: process.version, toolRoot, sameProcessRequests: 121, coldConfigure: summary(cold),
    warmConfigure: summary(warm), warmBatch200Identity: summary(batches)};
  await writeFile(output, JSON.stringify(result, null, 2)); process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {child.stdin.end();}

async function call(id, command, input) {
  child.stdin.write(JSON.stringify({id, command, input}) + "\n");
  const line = await lines.next(); if (line.done) {throw new Error("BENCHMARK_WORKER_CLOSED");}
  const row = JSON.parse(line.value); if (row.id !== id || row.error) {throw new Error(row.error ?? "BENCHMARK_ID_INVALID");}
  return row.result;
}
function summary(values) {
  values.sort((a, b) => a - b);
  return {count: values.length, p50Ms: values[Math.floor(values.length * .5)],
    p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * .95))]};
}
