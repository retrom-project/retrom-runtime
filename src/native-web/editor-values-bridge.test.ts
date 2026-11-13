import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {describe, expect, it} from "vitest";

type Reply = {type: string; requestId: number;
  body: {entries?: Array<Record<string, unknown>>; entry?: unknown; nextOffset?: number | null}};

function variableEditor(edition: "MV" | "MZ", initial: unknown[]) {
  const values = [null, ...initial];
  const listeners = new Map<string, (event: unknown) => void>();
  const replies: Reply[] = [];
  const runtime = {
    location: {href: "https://runtime.example/game/index.html"},
    Utils: {RPGMAKER_NAME: edition}, DataManager: {}, StorageManager: {},
    SceneManager: {updateMain() {}},
    $dataSystem: {variables: values.map((_, id) => `Value ${id}`), switches: [""]},
    $gameMap: {mapId: () => 1}, $gameParty: {}, $gameSwitches: {},
    $gameVariables: {value: (id: number) => values[id], setValue: (id: number, value: unknown) => {values[id] = value;}},
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    parent: {postMessage() {}}, requestAnimationFrame: () => 1,
  };
  runInNewContext(readFileSync(resolve("assets/runtime/native/bridge.js"), "utf8"),
    {URL, TextDecoder, TextEncoder, window: runtime});
  const identity = {launchId: "fixture", nonce: "fixture-nonce", protocolVersion: 1};
  const port = {onmessage: null as null | ((event: {data: unknown}) => void), start() {},
    postMessage: (reply: Reply) => replies.push(reply)};
  listeners.get("message")!({data: {...identity, parentOrigin: "https://host.example",
    profile: `RPG${edition}`, type: "RPG_RUNTIME_NATIVE_CONNECT", saves: null, pluginFiles: []},
  origin: "https://host.example", source: runtime.parent, ports: [port], stopImmediatePropagation() {}});
  let requestId = 0;
  return {
    values,
    async request(type: string, body: Record<string, unknown>) {
      const id = ++requestId;
      port.onmessage!({data: {...identity, requestId: id, type, body}});
      await new Promise(resolve => setTimeout(resolve, 0));
      const reply = replies.find(reply => reply.requestId === id);
      if (!reply) {throw new Error("EDITOR_REPLY_MISSING");}
      return reply;
    },
    entries(offset = 0, limit = 40) {
      return this.request("EDITOR_ENTRIES", {category: "variables", query: "", offset, limit});
    },
  };
}

describe.each(["MV", "MZ"] as const)("%s structured game values", edition => {
  it("reads and edits nested numeric arrays through the real isolated bridge", async () => {
    const editor = variableEditor(edition, [[null, [1, 10, 2.5]]]);
    expect((await editor.entries()).body.entries).toEqual([
      {id: "1", label: "Value 1", valueType: "collection", value: "数组 · 2 项", children: "variables:1"},
    ]);
    const children = await editor.request("EDITOR_ENTRIES", {category: "variables:1", query: "", offset: 0, limit: 40});
    expect(children.body.entries?.[0]).toMatchObject({label: "[0]", valueType: "null", value: null});
    const nested = children.body.entries![1];
    const numbers = await editor.request("EDITOR_ENTRIES", {category: nested.children, query: "", offset: 0, limit: 40});
    const target = numbers.body.entries![2];
    expect(target).toMatchObject({valueType: "number", value: 2.5, step: "any"});
    const reply = await editor.request("EDITOR_SET", {category: nested.children, id: target.id, value: 3.75});
    expect(reply.type).toBe("EDITOR_SET_RESULT");
    expect(editor.values[1]).toEqual([null, [1, 10, 3.75]]);
  });

  it("pages large arrays without serializing their entire contents", async () => {
    const editor = variableEditor(edition, [Array.from({length: 1200}, (_, id) => ({score: id, text: "x".repeat(500)}))]);
    expect((await editor.entries()).body.entries?.[0]).toMatchObject({valueType: "collection"});
    const page = await editor.request("EDITOR_ENTRIES", {category: "variables:1", query: "", offset: 40, limit: 40});
    expect(page.body.entries).toHaveLength(40);
    expect(page.body.entries?.[0]).toMatchObject({label: "[40]", valueType: "collection"});
    expect(page.body.nextOffset).toBe(80);
    expect(JSON.stringify(page).length).toBeLessThan(16_000);
  });

  it("keeps object property identities across reordering and rejects stale and cross-scope writes", async () => {
    const editor = variableEditor(edition, [{score: 4, name: "Hero", enabled: true}, [9]]);
    const page = await editor.request("EDITOR_ENTRIES", {category: "variables:1", query: "score", offset: 0, limit: 40});
    const target = page.body.entries![0];
    editor.values[1] = {name: "Hero", enabled: true, score: 4};
    expect((await editor.request("EDITOR_SET", {category: "variables:1", id: target.id, value: 8.25})).type)
      .toBe("EDITOR_SET_RESULT");
    expect(editor.values[1]).toEqual({name: "Hero", enabled: true, score: 8.25});
    expect((await editor.request("EDITOR_SET", {category: "variables:2", id: target.id, value: 10})).type).toBe("ERROR");
    editor.values[1] = {name: "Hero"};
    expect((await editor.request("EDITOR_SET", {category: "variables:1", id: target.id, value: 10})).type).toBe("ERROR");
    expect(editor.values[1]).toEqual({name: "Hero"});
  });

  it("leaves engine instances and accessors untouched and preserves sibling references", async () => {
    class Actor {hp = 10;}
    const actor = new Actor();
    let reads = 0;
    const original = {score: 2, actor, get live() {reads++; return 10;}};
    const editor = variableEditor(edition, [original]);
    const page = await editor.request("EDITOR_ENTRIES", {category: "variables:1", query: "", offset: 0, limit: 40});
    expect(page.body.entries?.filter(entry => entry.valueType === "unsupported").map(entry => entry.label))
      .toEqual(["actor", "live"]);
    const target = page.body.entries![0];
    await editor.request("EDITOR_SET", {category: "variables:1", id: target.id, value: 5});
    expect(reads).toBe(0);
    expect(editor.values[1] === original).toBe(false);
    expect(Object.getOwnPropertyDescriptor(editor.values[1], "actor")?.value).toBe(actor);
    expect(original.score).toBe(2);
  });

  it("bounds serialized pages and rejects invalid scalar writes", async () => {
    const editor = variableEditor(edition, Array.from({length: 40}, () => "\0".repeat(500)));
    const first = await editor.entries();
    expect(first.type).toBe("EDITOR_ENTRIES_RESULT");
    expect(first.body.nextOffset).toBeGreaterThan(0);
    expect(first.body.nextOffset).toBeLessThan(40);
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThan(64 * 1024);
    const numeric = variableEditor(edition, [2]);
    for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
      expect((await numeric.request("EDITOR_SET", {category: "variables", id: "1", value})).type).toBe("ERROR");
      expect(numeric.values[1]).toBe(2);
    }
  });
});
