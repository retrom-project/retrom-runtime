import {test} from "node:test";
import assert from "node:assert/strict";
const {fetch, AbortSignal} = globalThis;
import {fixtureBytes, byteAt} from "./fixture-bytes.mjs";
import {startFixtureServer} from "./fixture-server.mjs";
const scenario = (id, behavior = "NORMAL", fixtureId = "multi-tail") => ({id, behavior, fixtureId, seed: 17,
  delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
test("[S01] UNIT/fixture-vectors", () => {
  assert.deepEqual([0, 1, 250, 251].map((position) => byteAt(position)), [17, 18, 11, 34]);
  assert.throws(() => fixtureBytes(Number.MAX_SAFE_INTEGER, 1));
});
test("[S01] UNIT/fixture-http", {timeout: 10000}, async () => {
  const server = await startFixtureServer();
  try {
    const identity = server.register(scenario("ranges"));
    for (const [start, end] of [[0, 31], [262139, 262154], [786432, 786448]]) {
      const response = await fetch(`${server.origin}/objects/multi-tail/ranges`, {headers: {Range: `bytes=${start}-${end}`, "If-Match": identity.etag}});
      assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/786449`);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixtureBytes(start, end - start + 1));
    }
    const url = `${server.origin}/objects/multi-tail/ranges`;
    assert.equal((await fetch(url, {headers: {Range: "bytes=1-2", "If-Match": '"bad"'}})).status, 412);
    assert.equal((await fetch(url, {headers: {Range: "bytes=1-2,4-5"}})).status, 416);
    const head = await fetch(url, {method: "HEAD"}); assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(server.requests("ranges").length, 6);
  } finally {await server.close();}
});
test("[S01] UNIT/fixture-errors", {timeout: 10000}, async () => {
  const server = await startFixtureServer();
  try {
    for (const [mode, length] of [["SHORT_BODY", 0], ["LONG_BODY", 2]]) {
      server.register(scenario(mode, mode, "one"));
      const response = await fetch(`${server.origin}/objects/one/${mode}`);
      assert.equal((await response.arrayBuffer()).byteLength, length);
    }
    server.register(scenario("hang", "HANG_AFTER_EXPECTED_BYTES", "one"));
    await assert.rejects(async () => (await fetch(`${server.origin}/objects/one/hang`, {signal: AbortSignal.timeout(200)})).arrayBuffer());
    server.register(scenario("disconnect", "DISCONNECT"));
    await assert.rejects(async () => (await fetch(`${server.origin}/objects/multi-tail/disconnect`)).arrayBuffer());
    server.register(scenario("parallel"));
    await Promise.all(Array.from({length: 20}, async () => {
      const response = await fetch(`${server.origin}/objects/multi-tail/parallel`, {headers: {Range: "bytes=0-0"}});
      assert.equal((await response.arrayBuffer()).byteLength, 1);
    }));
    assert.equal(server.requests("parallel").length, 20);
  } finally {await server.close();}
});
