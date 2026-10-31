// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import type {RuntimeContentFile} from "../src/runtime/types.js";
import type {HostContentLocator} from "../scripts/runtime-host-content.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const signature = Buffer.from("5850330d0a200a1a8b6701", "hex");
async function managed() {
  const root=await mkdtemp(join(tmpdir(), "runtime-kiri-entries-")); roots.push(root);
  const content=[
    ["data.xp3", signature], ["startup.tjs", Buffer.from("// startup")],
    ["localized.exe", Buffer.concat([signature, Buffer.alloc(100)])],
    ["launcher.exe", Buffer.from("MZordinary Windows program")],
    ["picture.png", Buffer.from("ordinary image bytes")], ["script.tjs", Buffer.from("// ordinary script")],
    [".runtime-launches/module.dll.json", Buffer.from("{}")] ,
    ...Array.from({length:205},(_,i)=>[`projects/${String(i).padStart(3,"0")}/data.xp3`,signature]),
  ] as [string,Buffer][];
  const path=join(root,"package"),chunks:Buffer[]=[Buffer.from("unrelated header")];let offset=chunks[0].length;
  const files:RuntimeContentFile[]=[],locators:Record<string,HostContentLocator>={};
  for(const [logicalKey,bytes] of content) {
    files.push({logicalKey,name:logicalKey,sizeBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
    locators[logicalKey]={path,offset,sizeBytes:bytes.length}; chunks.push(bytes);offset+=bytes.length;
  }
  await writeFile(path,Buffer.concat(chunks));
  return {platformId:"kirikiri",files,locators};
}
async function cli(input:unknown):Promise<{entries:string[];nextCursor:string|null;error?:string}> {
  return new Promise((resolveResult,reject)=>{
    const child=execFile(process.execPath,[resolve("scripts/runtime-cli.mjs"),"kirikiri-entry-candidates"],{cwd:tmpdir(),timeout:10000},(_error,stdout)=>{
      try{resolveResult(JSON.parse(stdout));}catch(cause){reject(cause);}
    });child.stdin!.end(JSON.stringify(input));
  });
}
it("projects only runtime-authoritative entries before paginating, including non-xp3 signatures",async()=>{
  const input=await managed();
  const first=await cli({...input,limit:100});
  expect(first.error).toBeUndefined();expect(first.entries).toHaveLength(100);
  expect(first.entries).toContain("localized.exe");expect(first.entries).not.toContain("launcher.exe");
  const second=await cli({...input,limit:100,after:first.nextCursor});expect(second.entries).toHaveLength(100);
  const third=await cli({...input,limit:100,after:second.nextCursor});expect(third.entries).toHaveLength(8);expect(third.nextCursor).toBeNull();
  const all=[...first.entries,...second.entries,...third.entries];
  expect(new Set(all).size).toBe(208);expect(all).toContain("startup.tjs");
  expect(all.some(path=>/\.json$|\.png$|script\.tjs$|launcher\.exe$/u.test(path))).toBe(false);
  expect(await cli({...input,prefix:"projects/20",limit:100})).toEqual({entries:Array.from({length:5},(_,i)=>`projects/20${i}/data.xp3`),nextCursor:null});
  expect(await cli({...input,prefix:"not-present/",limit:100})).toEqual({entries:[],nextCursor:null});
});
it("rejects invalid page bounds and foreign platform requests",async()=>{
  const input=await managed();
  for(const page of [{limit:0},{limit:101},{limit:1.5},{prefix:42},{after:"a".repeat(1025)},{platformId:"ons"}]) {
    expect((await cli({...input,...page})).error).toBe("RUNTIME_CONFIGURATION_INVALID");
  }
});

it("uses the same UTF-8 order for cursors and sorting",async()=>{
  const input=await managed(), original=input.files[0], locator=input.locators[original.logicalKey];
  const paths=["\u{1f600}/data.xp3","\ue000/data.xp3"];
  const files=paths.map(logicalKey=>({...original,logicalKey,name:logicalKey}));
  const locators=Object.fromEntries(paths.map(path=>[path,locator]));
  const first=await cli({...input,files,locators,limit:1});
  expect(first).toEqual({entries:[paths[1]],nextCursor:paths[1]});
  expect(await cli({...input,files,locators,after:first.nextCursor,limit:1})).toEqual({entries:[paths[0]],nextCursor:null});
});
