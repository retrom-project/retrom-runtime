import {once} from "node:events";
import {setTimeout, clearTimeout} from "node:timers";
const {AbortController} = globalThis;

export const maximumMessage = 64 * 1024 * 1024;
const validId = id => typeof id === "string" ? /^[!-~]{1,128}$/u.test(id) : Number.isSafeInteger(id) && id >= 0;
const failure = error => error instanceof Error ? error.message : "RUNTIME_REQUEST_FAILED";
const deadline = command => command === "normalize-content" ? 60 * 60 * 1000 : command === "detect-scummvm" ? 60000 :
  command === "assemble-resource" ? 120000 : 30000;

async function* messages(input) {
  let length = 0, chunks = [];
  for await (const chunk of input) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start), end = newline === -1 ? chunk.length : newline;
      length += end - start;
      if (length > maximumMessage) {throw new Error("RUNTIME_REQUEST_TOO_LARGE");}
      chunks.push(chunk.subarray(start, end));
      if (newline === -1) {break;}
      yield {line: Buffer.concat(chunks, length).toString("utf8"), size: length};
      length = 0; chunks = []; start = newline + 1;
    }
  }
  if (length) {yield {line: Buffer.concat(chunks, length).toString("utf8"), size: length};}
}

/** One reader and one backpressured writer, with bounded execution and queued input. */
export async function serveJSONL(execute, {input = process.stdin, output = process.stdout, concurrency = 4, capacity = 32} = {}) {
  const requests = new Map(), queue = [], running = new Set();
  let inputBytes = 0, outputBytes = 0, writer = Promise.resolve(), transportError;
  function write(value) {
    const encoded = JSON.stringify(value) + "\n", size = Buffer.byteLength(encoded);
    if (size > maximumMessage) {throw new Error("RUNTIME_RESPONSE_TOO_LARGE");}
    if (outputBytes + size > maximumMessage) {throw new Error("RUNTIME_OUTPUT_BACKPRESSURE");}
    outputBytes += size;
    const next = writer.then(async () => {
      if (!output.write(encoded)) {await once(output, "drain");}
    }).finally(() => {outputBytes -= size;});
    writer = next.catch(error => {transportError ??= error; for (const request of requests.values()) {request.controller.abort();}});
    return next;
  }
  function release(request) {
    requests.delete(request.id); inputBytes -= request.size;
  }
  function dispatch() {
    while (running.size < concurrency && queue.length && !transportError) {
      const request = queue.shift();
      if (request.controller.signal.aborted) {continue;}
      const task = run(request).catch(error => {
        transportError ??= error;
        for (const request of requests.values()) {request.controller.abort();}
      }).finally(() => {running.delete(task); dispatch();});
      running.add(task);
    }
  }
  async function run(request) {
    const signal = request.controller.signal;
    const timer = setTimeout(() => request.controller.abort(), deadline(request.command));
    try {
      const result = await execute(request.command, request.input, signal);
      signal.throwIfAborted();
      await write({id: request.id, result});
    } catch (error) {
      await write({id: request.id, error: signal.aborted ? "RUNTIME_CANCELLED" : failure(error),
        ...(!signal.aborted && error?.message === "RUNTIME_PARENT_MISSING" ? {errorDetails: error.details} : {})});
    } finally {clearTimeout(timer); release(request);}
  }
  try {
    for await (const {line, size} of messages(input)) {
      if (transportError) {throw transportError;}
      let id = null;
      try {
        const value = JSON.parse(line);
        if (value && validId(value.id)) {id = value.id;}
        if (value && Object.keys(value).length === 1 && validId(value.cancel)) {
          const request = requests.get(value.cancel);
          if (request) {
            request.controller.abort();
            const index = queue.indexOf(request);
            if (index >= 0) {queue.splice(index, 1); release(request); await write({id: request.id, error: "RUNTIME_CANCELLED"});}
          }
          continue;
        }
        if (!value || Object.keys(value).length !== 3 || id === null || requests.has(id) ||
            typeof value.command !== "string" || !/^[a-z][a-z-]{0,63}$/u.test(value.command) ||
            !value.input || typeof value.input !== "object" || Array.isArray(value.input)) {throw new Error("RUNTIME_REQUEST_INVALID");}
        if (requests.size >= capacity || inputBytes + size > maximumMessage) {throw new Error("RUNTIME_BUSY");}
        const request = {...value, size, controller: new AbortController()};
        requests.set(id, request); inputBytes += size; queue.push(request); dispatch();
      } catch (error) {await write({id, error: failure(error)});}
    }
    while (running.size || queue.length) {await Promise.allSettled([...running]); if (transportError) {throw transportError;}}
    await writer;
    if (transportError) {throw transportError;}
  } catch (error) {
    for (const request of requests.values()) {request.controller.abort();}
    queue.length = 0;
    await Promise.allSettled([...running]); await writer;
    throw error;
  }
}
