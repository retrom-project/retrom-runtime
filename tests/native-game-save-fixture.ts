import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import {createContext, runInContext} from "node:vm";
import {expect, vi} from "vitest";
import type {RpgCheckpointBundle} from "../src/checkpoint.js";
import type {RpgPluginFile} from "../src/native-web/plugin-files.js";

export function nativeGameFixture(engine: "MV" | "MZ", restored: RpgCheckpointBundle | null = null,
  existing: {local?: Record<string, string>; forage?: Record<string, string>; pluginFiles?: RpgPluginFile[]; beforeConnect?: string} = {}) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const replies: Array<{type: string; requestId: number; body: Record<string, unknown>}> = [];
  const port = {onmessage: null as null | ((event: {data: unknown}) => void), start() {},
    postMessage(message: (typeof replies)[number]) {replies.push(message);}};
  const context = createContext({TextEncoder, TextDecoder, URL, performance, setTimeout, crypto: webcrypto,
    engine, existing, parent: {postMessage() {}}, document: {}, location: {href: "https://game.test/run/id/A%20Game/www/index.html"},
    requestAnimationFrame() {},
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, [...listeners.get(name) ?? [], callback]),
  });
  runInContext(`window = globalThis;
    var local = new Map(), forage = new Map(), trace = [], blockImport = null;
    var localStorage = {get length() {return local.size;}, key: i => [...local.keys()][i],
      getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key,value), clear: () => local.clear()};
    var localforage = {keys: async () => [...forage.keys()], getItem: async key => forage.get(key) ?? null, clear: async () => forage.clear(),
      async setItem(key,value) {if(blockImport) await blockImport; forage.set(key,value);}};
    for (const [key,value] of Object.entries(existing.local || {})) local.set(key,value);
    for (const [key,value] of Object.entries(existing.forage || {})) forage.set(key,value);
    var Utils = {RPGMAKER_NAME: engine};
    var StorageManager = {forageTestKey: () => 'rmmzsave.test', webStorageKey: slot => 'RPG File' + slot,
      forageKey: name => 'rmmzsave.1.' + name, localFileDirectoryPath: () => {throw Error('desktop path');}};
    var DataManager = {_globalInfoCache: null, maxSavefiles: () => 50, makeSavename: slot => 'file' + slot,
      loadGlobalInfo() {return this._globalInfoCache ??= JSON.parse(localStorage.getItem('RPG Global') || '[]');},
      saveGame(slot) {
        localStorage.setItem('RPG File'+slot, JSON.stringify({position:42}));
        const info = this.loadGlobalInfo(); info[slot] = {title:'Native fixture'};
        localStorage.setItem('RPG Global',JSON.stringify(info)); return true;
      },
      loadGame(slot) {
        trace.push('load'); if(!this.loadGlobalInfo()[slot]) return false;
        return JSON.parse(localStorage.getItem('RPG File'+slot));
      }
    };
    var Scene_Boot = class {start() {DataManager.loadGlobalInfo();trace.push('boot');}};
    var SceneManager = {_scene: {name:'title'}, run() {new Scene_Boot().start();}, updateMain() {}, exit() {trace.push('exit');}};
  `, context);
  runInContext(readFileSync("assets/runtime/native/bridge.js", "utf8"), context);
  const read = (source: string): unknown => runInContext(source, context);
  const transfer = (value: unknown) => {
    context.transferred = JSON.stringify(value, (_key, value: unknown) => ArrayBuffer.isView(value) ? [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)] : value);
    return read("JSON.parse(transferred, (key,value) => key === 'data' ? new Uint8Array(value).buffer : value)");
  };
  const identity = {launchId: "fixture", nonce: "nonce", protocolVersion: 1};
  if (existing.beforeConnect) read(existing.beforeConnect);
  listeners.get("message")?.forEach(listener => listener({source: context.parent, origin: "https://host.test", ports: [port],
    stopImmediatePropagation() {}, data: {...identity, parentOrigin: "https://host.test", profile: "RPG" + engine,
      type: "RPG_RUNTIME_NATIVE_CONNECT", saves: transfer(restored),
      pluginFiles: transfer((existing.pluginFiles ?? []).map(file => ({path: file.path, data: new Uint8Array(file.data)})))}}));
  let id = 0;
  return {read, context, replies,
    async boot() {
      listeners.get("load")?.forEach(listener => listener({target: context.document}));
      read("SceneManager.run(Scene_Boot)");
      await vi.waitFor(() => expect(read("trace.includes('boot')")).toBe(true));
    },
    async request(type: string, body: Record<string, unknown> = {}) {
      const requestId = ++id;
      port.onmessage?.({data: {...identity, requestId, type, body: transfer(body)}});
      await vi.waitFor(() => expect(replies.some(reply => reply.requestId === requestId)).toBe(true));
      return replies.find(reply => reply.requestId === requestId)!;
    },
  };
}
