import {createServer} from "node:http";
import {once} from "node:events";
import {createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {Buffer} from "node:buffer";
import {URL} from "node:url";
import {BLOCK_BYTES, fixtureBytes, sizes} from "./fixture-bytes.mjs";

export const behaviors = ["NORMAL", "IGNORE_RANGE", "WRONG_START", "WRONG_END", "WRONG_TOTAL", "MISSING_ETAG", "WEAK_ETAG",
  "CHANGED_ETAG", "CORRUPT_BODY", "MISSING_LENGTH", "WRONG_LENGTH", "SHORT_BODY", "LONG_BODY", "HANG_AFTER_EXPECTED_BYTES", "STATUS_412",
  "STATUS_416", "STATUS_429_ONCE", "STATUS_503_ONCE", "REDIRECT", "GZIP_RANGE", "MULTIPART", "DISCONNECT"];
export function fixtureIdentity(id, seed = 17) {
  if (!Object.hasOwn(sizes, id)) {throw new Error("FIXTURE_ID_INVALID");}
  const sizeBytes = sizes[id];
  if (id === "big-offset") {
    return {sizeBytes, etag: '"fixture-big-offset-v1"', identity: {kind: "INDEX_ENTRY",
      projectDigest: createHash("sha256").update(JSON.stringify({id, sizeBytes, seed})).digest("hex"), logicalPath: id}};
  }
  const hash = createHash("sha256");
  for (let offset = 0; offset < sizeBytes; offset += BLOCK_BYTES) {hash.update(fixtureBytes(offset, Math.min(BLOCK_BYTES, sizeBytes - offset), seed));}
  const sha256 = hash.digest("hex");
  return {sizeBytes, etag: `"sha256-${sha256}"`, identity: {kind: "FILE_SHA256", sha256}};
}
function scenario(value) {
  const keys = ["id", "fixtureId", "behavior", "seed", "delayBeforeHeadersMs", "chunkDelayMs", "disconnectAfterBytes", "barrier"];
  if (!value || Object.keys(value).sort().join() !== keys.sort().join() || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value.id) ||
    !Object.hasOwn(sizes, value.fixtureId) || !behaviors.includes(value.behavior) ||
    !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 255) {throw new Error("FIXTURE_SCENARIO_INVALID");}
  for (const field of ["delayBeforeHeadersMs", "chunkDelayMs", "disconnectAfterBytes"]) {
    if (value[field] !== null && (!Number.isSafeInteger(value[field]) || value[field] < 0 || value[field] > 60000)) {
      throw new Error("FIXTURE_SCENARIO_INVALID");
    }
  }
  if (value.barrier !== null && !/^[a-zA-Z0-9_-]{1,80}$/u.test(value.barrier)) {throw new Error("FIXTURE_SCENARIO_INVALID");}
  return Object.freeze({...value});
}
async function jsonBody(request) {
  const parts = []; let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > 4096) {throw new Error("FIXTURE_CONTROL_TOO_LARGE");}
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export async function startFixtureServer({contentModule, modules = {}, staticFiles = {}} = {}) {
  const scenarios = new Map(), records = new Map(), barriers = new Map(), fileRequests = [];
  const register = (value) => {
    const checked = scenario(value);
    if (scenarios.has(checked.id)) {throw new Error("FIXTURE_SCENARIO_DUPLICATE");}
    scenarios.set(checked.id, checked); records.set(checked.id, []);
    return fixtureIdentity(checked.fixtureId, checked.seed);
  };
  function release(id) {barriers.get(id)?.resolve(); barriers.delete(id);}
  function barrier(id) {
    if (!barriers.has(id)) {
      let resolve; const promise = new Promise((done) => {resolve = done;});
      barriers.set(id, {resolve, promise});
    }
    return barriers.get(id).promise;
  }
  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      if (!response.headersSent) {response.writeHead(400); response.end(error.message);}
      else {response.destroy();}
    });
  });
  async function route(request, response) {
    const path = new URL(request.url, "http://127.0.0.1").pathname.split("/").slice(1);
    if (path[0] === "__test__") {
      if (request.method === "GET" && path[1] === "content.mjs" && contentModule) {
        response.writeHead(200, {"Content-Type": "text/javascript", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin"}); response.end(contentModule); return;
      }
      if (request.method === "GET" && Object.hasOwn(modules, path.slice(1).join("/"))) {
        response.writeHead(200, {"Content-Type": "text/javascript", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin"}); response.end(modules[path.slice(1).join("/")]); return;
      }
      if (request.method === "GET" && path[1] === "page") {
        response.writeHead(200, {"Content-Type": "text/html", "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp"});
        response.end("<!doctype html><title>Content I/O protocol fixture</title>"); return;
      }
      if (request.method === "POST" && path[1] === "scenarios") {response.end(JSON.stringify(register(await jsonBody(request)))); return;}
      if (request.method === "POST" && path[1] === "release") {release(path[2]); response.end("{}"); return;}
      if (request.method === "GET" && path[1] === "requests" && records.has(path[2])) {response.end(JSON.stringify(records.get(path[2]))); return;}
      response.writeHead(404); response.end(); return;
    }
    if (path[0] === "files" && Object.hasOwn(staticFiles, path[1])) {
      const bytes = staticFiles[path[1]], sha256 = createHash("sha256").update(bytes).digest("hex");
      fileRequests.push({name: path[1], method: request.method, range: request.headers.range ?? null});
      response.writeHead(200, {"Content-Type": "application/octet-stream", "Content-Length": bytes.length,
        "ETag": `"sha256-${sha256}"`, "Cross-Origin-Resource-Policy": "same-origin"});
      response.end(bytes); return;
    }
    const entry = scenarios.get(path[2]);
    if (path[0] !== "objects" || !entry || entry.fixtureId !== path[1] || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404); response.end(); return;
    }
    const record = {method: request.method, range: request.headers.range ?? null, ifMatch: request.headers["if-match"] ?? null,
      sentBytes: 0, complete: false, disconnected: false};
    records.get(entry.id).push(record);
    response.on("finish", () => {record.complete = true;});
    response.on("close", () => {record.disconnected = !record.complete;});
    if (entry.barrier) {await Promise.race([barrier(entry.barrier), once(response, "close")]);}
    if (entry.delayBeforeHeadersMs) {await delay(entry.delayBeforeHeadersMs);}
    if (response.destroyed) {return;}
    await objectResponse(request, response, entry, record, records.get(entry.id).length);
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {origin, register, release, fileRequests, requests: (id) => records.get(id),
    async close() {for (const id of barriers.keys()) {release(id);} server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));}};
}
async function objectResponse(request, response, entry, record, attempt) {
  const identity = fixtureIdentity(entry.fixtureId, entry.seed), size = identity.sizeBytes;
  const mode = entry.behavior;
  let status = earlyStatus(mode, attempt);
  if (request.headers["if-match"] && request.headers["if-match"] !== identity.etag) {status = 412;}
  if (status) {response.writeHead(status, mode === "REDIRECT" ? {Location: "http://localhost:9/rejected"} : {}); response.end(); return;}
  let start = 0, end = size - 1, partial = false;
  if (request.headers.range && mode !== "IGNORE_RANGE") {
    const match = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.range);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[1]) > Number(match[2]) || Number(match[2]) >= size) {
      response.writeHead(416, {"Content-Range": `bytes */${size}`}); response.end(); return;
    }
    start = Number(match[1]); end = Number(match[2]); partial = true;
  }
  const length = Math.max(0, end - start + 1), headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"};
  if (mode !== "MISSING_ETAG") {headers.ETag = mode === "WEAK_ETAG" ? `W/${identity.etag}` : mode === "CHANGED_ETAG" ? '"changed"' : identity.etag;}
  if (!["MISSING_LENGTH", "SHORT_BODY", "LONG_BODY", "HANG_AFTER_EXPECTED_BYTES"].includes(mode)) {
    headers["Content-Length"] = String(length + (mode === "WRONG_LENGTH" ? 1 : 0));
  }
  if (partial) {headers["Content-Range"] = `bytes ${start + (mode === "WRONG_START" ? 1 : 0)}-${end + (mode === "WRONG_END" ? 1 : 0)}/${size + (mode === "WRONG_TOTAL" ? 1 : 0)}`;}
  if (mode === "GZIP_RANGE") {headers["Content-Encoding"] = "gzip";}
  if (mode === "MULTIPART") {headers["Content-Type"] = "multipart/byteranges; boundary=bad";}
  response.writeHead(partial ? 206 : 200, headers); response.flushHeaders();
  if (request.method === "HEAD") {response.end(); return;}
  const sendLength = Math.max(0, length + (mode === "SHORT_BODY" ? -1 : mode === "LONG_BODY" ? 1 : 0));
  for (let written = 0; written < sendLength && !response.destroyed;) {
    const chunk = fixtureBytes(start + written, Math.min(16384, sendLength - written), entry.seed);
    if (mode === "CORRUPT_BODY" && written === 0 && chunk.length) {chunk[0] ^= 1;}
    const writable = response.write(chunk); record.sentBytes += chunk.length; written += chunk.length;
    if (mode === "DISCONNECT" && written >= (entry.disconnectAfterBytes ?? 16384)) {response.destroy(); return;}
    if (!writable) {await writableOrClosed(response);}
    if (entry.chunkDelayMs) {await delay(entry.chunkDelayMs);}
  }
  if (!response.destroyed && mode !== "HANG_AFTER_EXPECTED_BYTES") {response.end();}
}
function earlyStatus(mode, attempt) {
  if (mode === "STATUS_412") {return 412;}
  if (mode === "STATUS_416") {return 416;}
  if (mode === "REDIRECT") {return 302;}
  if (attempt === 1 && mode === "STATUS_429_ONCE") {return 429;}
  if (attempt === 1 && mode === "STATUS_503_ONCE") {return 503;}
  return 0;
}

function writableOrClosed(response) {
  return new Promise((resolve) => {
    const done = () => {response.off("drain", done); response.off("close", done); resolve();};
    response.once("drain", done); response.once("close", done);
    if (response.destroyed) {done();}
  });
}
