import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach, expect, it, vi} from "vitest";

afterEach(() => {document.body.replaceChildren(); document.head.replaceChildren();});

type Message = {type: string; requestId: number; body: Record<string, unknown>};
type Handler = (event: Record<string, unknown> | KeyboardEvent) => void;
function bridge(name: "native" | "tyranoscript") {
  const handlers = new Map<string, Set<Handler>>(), replies: Message[] = [];
  const parent = {postMessage() {}};
  const port = {onmessage: null as null | ((event: {data: unknown}) => void), postMessage: (message: Message) => replies.push(message), start() {}, close() {}};
  const kag = {on() {}, once() {}, off() {}, trigger() {}, chara: {}, event: {}, layer: {},
    ftag: {array_tag: [{name:"s"}],current_order_index:0}, key_mouse:{util:{canShowMenu:()=>true}},
    menu:{}, stat:{current_scenario:"first.ks",f:{}}};
  const global = {parent, document, location: {href:"https://runtime.example/game/www/index.html"}, TYRANO:{kag}, Utils:{RPGMAKER_NAME:"MV"}, SceneManager:{updateMain() {}},
    DataManager:{},StorageManager:{}, navigator:{getGamepads:()=>[]}, performance:{now:()=>100},
    Event: window.Event, focus() {}, dispatchEvent() {}, matchMedia: () => ({matches: true}),
    requestAnimationFrame:()=>1, cancelAnimationFrame() {}, setInterval:()=>1, clearInterval() {},
    addEventListener(name: string, handler: Handler) {const set=handlers.get(name)??new Set<Handler>();set.add(handler);handlers.set(name,set);},
    removeEventListener(name: string, handler: Handler) {handlers.get(name)?.delete(handler);}};
  runInNewContext(readFileSync(`assets/runtime/${name}/bridge.js`,"utf8"), {window:global,TextEncoder,TextDecoder,URL});
  const identity = {protocolVersion:1,nonce:"abcdefghijklmnop",[name==="native"?"launchId":"sessionId"]:"session"};
  const configuration = {...identity,parentOrigin:"https://host.example",type:name==="native"?"RPG_RUNTIME_NATIVE_CONNECT":"GAME_RUNTIME_TYRANOSCRIPT_CONNECT",...(name==="native"?{profile:"RPGMV",pluginFiles:[]}:{})};
  const connect=(source: unknown,origin="https://host.example")=>{
    for(const handler of [...handlers.get("message")??[]]) {handler({source,origin,ports:[port],data:configuration,stopImmediatePropagation() {}});}
  };
  let sequence=0;
  const request=async(type:string,body:Record<string,unknown>)=>{
    const requestId=++sequence; port.onmessage?.({data:{...identity,requestId,type,body}});
    await vi.waitFor(()=>expect(replies.some(reply=>reply.requestId===requestId)).toBe(true));
    return replies.find(reply=>reply.requestId===requestId)!;
  };
  const key=(code:string)=>{const event=new KeyboardEvent("keydown",{key:code,code,cancelable:true});
    for(const handler of [...handlers.get("keydown")??[]]) {handler(event);}return event;};
  return {connect,parent,port,identity,replies,request,key};
}

it("Tyrano runs the shared touch pad only through the parent channel and releases input when paused or hidden", async () => {
  const b = bridge("tyranoscript"); b.connect(b.parent);
  for (const body of [{enabled: "yes"}, {enabled: true, extra: true}]) {
    expect((await b.request("SET_TOUCH_GAMEPAD", body)).type).toBe("ERROR");
  }
  expect((await b.request("SET_TOUCH_GAMEPAD", {enabled: false})).type).toBe("SET_TOUCH_GAMEPAD_RESULT");
  const root = document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
  expect(root.hidden).toBe(true);
  await b.request("SET_TOUCH_GAMEPAD", {enabled: true});
  expect(root.hidden).toBe(false);
  root.querySelector('[data-face="bottom"]')!.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", pointerId: 1}));
  expect(root.querySelector("[data-active]")).not.toBeNull();
  await b.request("PAUSE", {}); expect(root.hidden).toBe(true);
  await b.request("RESUME", {}); expect(root.hidden).toBe(false);
  expect(root.querySelector("[data-active]")).toBeNull();
  await b.request("SET_TOUCH_GAMEPAD", {enabled: false});
  document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch"}));
  expect(root.hidden).toBe(true);
  await b.request("CLEANUP", {});
  expect(document.querySelector("[data-retrom-touch-gamepad]")).toBeNull();
});

it.each(["native","tyranoscript"] as const)("%s accepts shortcut policy only through the verified parent channel and stops on cleanup",async(name)=>{
  const b=bridge(name);
  b.connect({}); expect(b.port.onmessage).toBeNull();
  b.connect(b.parent,"https://other.example");expect(b.port.onmessage).toBeNull();
  b.connect(b.parent);expect(b.port.onmessage).not.toBeNull();
  for(const identity of [{...b.identity,nonce:"different"},{...b.identity,[name==="native"?"launchId":"sessionId"]:"foreign"}]){
    b.port.onmessage?.({data:{...identity,requestId:90,type:"SET_HOST_SHORTCUT_POLICY",body:{policy:{menu:"KeyM",pause:false}}}});
  }
  expect(b.key("KeyM").defaultPrevented).toBe(false);
  expect((await b.request("SET_HOST_SHORTCUT_POLICY",{policy:{menu:"KeyM",pause:false,extra:true}})).type).toBe("ERROR");
  expect((await b.request("SET_HOST_SHORTCUT_POLICY",{policy:{menu:"KeyM",pause:false},extra:true})).type).toBe("ERROR");
  expect((await b.request("SET_HOST_SHORTCUT_POLICY",{policy:{menu:"KeyM",pause:false}})).type).toBe("SET_HOST_SHORTCUT_POLICY_RESULT");
  expect(b.key("Escape").defaultPrevented).toBe(false);
  expect(b.key("KeyM").defaultPrevented).toBe(true);
  expect(b.replies.filter(reply=>reply.type==="HOST_SHORTCUT")).toMatchObject([{requestId:0,body:{shortcut:"MENU"}}]);
  await b.request("SET_INPUT_FILTER",{policy:{activeGamepadIndex:null,suppressInput:true}});
  expect(b.key("KeyM").defaultPrevented).toBe(false);
  await b.request("SET_INPUT_FILTER",{policy:null});
  await b.request("SET_HOST_SHORTCUT_POLICY",{policy:{menu:"Escape",pause:true}});
  expect(b.key("KeyM").defaultPrevented).toBe(false);
  expect(b.key("Escape").defaultPrevented).toBe(true);
  expect(b.key("KeyP").defaultPrevented).toBe(true);
  expect(b.replies.filter(reply=>reply.type==="HOST_SHORTCUT").map(reply=>reply.body.shortcut)).toEqual(["MENU","MENU","PAUSE"]);
  await b.request("CLEANUP",{});
  expect(b.key("Escape").defaultPrevented).toBe(false);
  expect(b.replies.filter(reply=>reply.type==="HOST_SHORTCUT")).toHaveLength(3);
});
