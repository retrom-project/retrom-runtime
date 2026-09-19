import assert from "node:assert/strict";
import test from "node:test";
import {auditSource, scanBoundaries} from "./boundaries.mjs";

for (const [name, code] of Object.entries({
  call: 'const download = globalThis.fetch; export function bridge() { return download.call(globalThis, "/game"); }',
  computed: 'export function bridge() { return globalThis["fe" + "tch"]("/game"); }',
  alias: 'const download = globalThis.fetch; export function bridge() { return download("/game"); }',
  bound: 'const download = globalThis["fetch"].bind(globalThis); export function bridge() { return download("/game"); }',
  destructured: 'const {fetch: download} = globalThis; export function bridge() { return download("/game"); }',
  storage: 'const {open: acquire} = indexedDB; export function bridge() { return acquire("private"); }',
  constant: 'const method = "fetch"; export function bridge() { return self[method]("/game"); }',
})) {
  test(`[PK-06] CONTRACT/boundary-${name} classifies aliases and computed capabilities`, () => {
    assert.throws(() => auditSource("runtime", "src/bridge.ts", code, []), /UNCLASSIFIED/);
    assert.ok(scanBoundaries("src/bridge.ts", code).some(site => site.symbol === "bridge"));
  });
}
test("[PK-06] CONTRACT/boundary-shadowing keeps local bindings separate", () => {
  const code = 'const download = fetch; function outer() { const download = localRead; return download(); } function bridge() { return download("/game"); }';
  const sites = scanBoundaries("src/bridge.ts", code);
  assert.deepEqual(sites.map(site => site.symbol), ["bridge"]);
});


const entry = {id: "metadata", repository: "runtime", path: "src/metadata.ts", symbol: "loadIndex",
  classification: "METADATA", reason: "Bounded index JSON only", ownerStage: "S21", tests: ["metadata.test.ts"]};
test("[X-27] CONTRACT/boundaries rejects an injected fetch in a thin bridge or unregistered helper", () => {
  const original = "export function bridge(reader) {return reader.read(0, 1)}";
  assert.deepEqual(auditSource("runtime", "src/bridge.ts", original, []), []);
  const injected = original.replace("return reader", "fetch('/game'); return reader");
  assert.throws(() => auditSource("runtime", "src/bridge.ts", injected, []), /UNCLASSIFIED/);
  assert.throws(() => auditSource("runtime", "src/bridge.ts", injected, [{...entry,
    path: "src/bridge.ts", symbol: "bridge", classification: "CORE_BRIDGE"}]), /PRIVATE_TRANSPORT/);
  assert.throws(() => auditSource("runtime", "src/private-helper.ts", "export const acquire = url => fetch(url)", []), /UNCLASSIFIED/);
});
test("[X-27] CONTRACT/boundaries identifies methods and nested callbacks without matching comment text", () => {
  const code = "// fetch('/not-code')\nexport function loadIndex(url) {return Promise.resolve().then(() => fetch(url));}";
  const sites = auditSource("runtime", entry.path, code, [entry]);
  assert.equal(sites.length, 1); assert.equal(sites[0].symbol, "loadIndex");
  assert.equal(scanBoundaries("test.ts", "class Reader { read() {return globalThis.fetch('/game')} }")[0].symbol, "Reader.read");
});
