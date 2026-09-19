// @vitest-environment node
import {readFile} from "node:fs/promises";
import {expect,it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {assertScummvmCandidateMode} from "../scripts/scummvm-release.mjs";
it("[PK-06] CONTRACT/PSP requires an explicit unpublished ABI-v3 candidate with no private I/O Worker",async()=>{
 const sources=JSON.parse(await readFile("provider-sources.json","utf8"));validateProviderSources(sources);
 const input=sources.developmentInputs.find((v:{id:string})=>v.id==="ppsspp");
 expect(input).toMatchObject({repository:"https://github.com/retrom-project/ppsspp",upstreamCommit:"2e6fd06ed6c77db467dea5fb3f67abd93457da20",adapterAbi:"ppsspp-host-v3"});
 expect(input).not.toHaveProperty("tag");expect(sources.upstreamReleases.some((v:{id:string})=>v.id==="ppsspp")).toBe(false);
 expect(input.assets.map((v:{filename:string})=>v.filename).sort()).toEqual(["LICENSE","ppsspp-host.mjs","ppsspp.data","ppsspp.js","ppsspp.wasm","ppsspp.worker.mjs"]);
 expect(()=>assertScummvmCandidateMode([input],true,true)).toThrow("UNPUBLISHED_CORE_INPUT");
 input.assets[0].maxSizeBytes=0;expect(()=>validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
});
