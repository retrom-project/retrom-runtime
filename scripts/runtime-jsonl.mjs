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

function limit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {throw new Error("RUNTIME_SCHEDULER_LIMIT_INVALID");}
  return value;
}
function lane(concurrency, capacity, inputCapacity) {return {concurrency, capacity, inputCapacity, bytes: 0, count: 0, active: 0, queue: []};}

/** Separate bounded FIFO lanes; cancellation retains execution until the executor settles. */
export async function serveJSONL(execute, {input = process.stdin, output = process.stdout, concurrency = 4, capacity = 32,
  normalizationConcurrency = 2, normalizationCapacity = 6, inputCapacity = maximumMessage, normalizationInputCapacity = maximumMessage} = {}) {
  const interactive = lane(limit(concurrency, 4), limit(capacity, 32), limit(inputCapacity, maximumMessage));
  const normalization = lane(limit(normalizationConcurrency, 2), limit(normalizationCapacity, 6), limit(normalizationInputCapacity, maximumMessage));
  const requests = new Map(), running = new Set(), transport = new AbortController();
  let outputBytes = 0, writer = Promise.resolve(), transportError;
  function release(request) {
    if (requests.get(request.id) !== request) {return;}
    requests.delete(request.id); clearTimeout(request.timer);
    request.lane.bytes -= request.size; request.lane.count--;
  }
  function stop(error) {
    transportError ??= error; transport.abort();
    for (const request of requests.values()) {
      request.controller.abort();
      const index = request.lane.queue.indexOf(request);
      if (index >= 0) {request.lane.queue.splice(index, 1); release(request);}
    }
    if (!input.destroyed) {input.destroy();}
  }
  const outputError = error => stop(error), outputClose = () => stop(new Error("RUNTIME_OUTPUT_CLOSED"));
  output.on("error", outputError); output.on("close", outputClose);
  function write(value) {
    if (transportError) {throw transportError;}
    const encoded = JSON.stringify(value) + "\n", size = Buffer.byteLength(encoded);
    if (size > maximumMessage) {throw new Error("RUNTIME_RESPONSE_TOO_LARGE");}
    if (outputBytes + size > maximumMessage) {throw new Error("RUNTIME_OUTPUT_BACKPRESSURE");}
    outputBytes += size;
    const next = writer.then(async () => {
      if (output.destroyed || output.writableEnded) {throw new Error("RUNTIME_OUTPUT_CLOSED");}
      if (!output.write(encoded)) {await once(output, "drain", {signal: transport.signal});}
    }).finally(() => {outputBytes -= size;});
    writer = next.catch(stop);
    return next;
  }
  function dispatch(selected) {
    while (selected.active < selected.concurrency && selected.queue.length && !transportError) {
      const request = selected.queue.shift(); selected.active++;
      const task = run(request).catch(stop).finally(() => {selected.active--; running.delete(task); dispatch(selected);});
      running.add(task);
    }
  }
  async function cancel(request) {
    request.controller.abort();
    const index = request.lane.queue.indexOf(request);
    if (index >= 0) {
      request.lane.queue.splice(index, 1);
      try {await write({id: request.id, error: "RUNTIME_CANCELLED"});} finally {release(request);}
      dispatch(request.lane);
    }
  }
  async function run(request) {
    const signal = request.controller.signal;
    try {
      const result = await execute(request.command, request.input, signal);
      signal.throwIfAborted();
      await write({id: request.id, result});
    } catch (error) {
      if (!transportError) {await write({id: request.id, error: signal.aborted ? "RUNTIME_CANCELLED" : failure(error),
        ...(!signal.aborted && error?.message === "RUNTIME_PARENT_MISSING" ? {errorDetails: error.details} : {})});}
    } finally {release(request);}
  }
  function admit(value, size) {
    const selected = value.command === "normalize-content" ? normalization : interactive;
    if (selected.count >= selected.capacity || size > selected.inputCapacity - selected.bytes) {throw new Error("RUNTIME_BUSY");}
    const request = {...value, size, lane: selected, controller: new AbortController()};
    requests.set(value.id, request); selected.bytes += size; selected.count++; selected.queue.push(request);
    request.timer = setTimeout(() => {cancel(request).catch(stop);}, deadline(request.command));
    dispatch(selected);
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
          if (request) {await cancel(request);}
          continue;
        }
        if (!value || Object.keys(value).length !== 3 || id === null || requests.has(id) ||
            typeof value.command !== "string" || !/^[a-z][a-z-]{0,63}$/u.test(value.command) ||
            !value.input || typeof value.input !== "object" || Array.isArray(value.input)) {throw new Error("RUNTIME_REQUEST_INVALID");}
        admit(value, size);
      } catch (error) {await write({id, error: failure(error)});}
    }
    // Clean EOF drains accepted work; broken transport aborts both lanes.
    while (running.size) {await Promise.allSettled([...running]); if (transportError) {throw transportError;}}
    await writer;
    if (transportError) {throw transportError;}
  } catch (error) {
    stop(error); await Promise.allSettled([...running]); await writer;
    throw transportError;
  } finally {
    output.off("error", outputError); output.off("close", outputClose);
  }
}
