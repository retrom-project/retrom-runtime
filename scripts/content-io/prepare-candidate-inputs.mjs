import {contractHash} from "./contract.mjs";
import {mkdir,readFile,readdir,lstat,copyFile} from "node:fs/promises";
import {join,dirname,basename} from "node:path";
import {argumentsFor,absolutePath,within,atomicJSON,main} from "./cli.mjs";
import {readPFB,runtimeRoot} from "./preflight.mjs";
import {hash} from "./evidence.mjs";
import {validateProviderSources} from "../provider-sources.mjs";
export async function prepareInputs(environment,output) {
 const retrom=environment.repositories.retrom.root;
 within(join(retrom,".pfb/candidates"),output);await absolutePath(dirname(output));
 const context=readPFB(retrom,environment.pfb.name);
 if(context.pfb.id!==environment.pfb.id||context.repositories.runtime.root!==runtimeRoot){throw new Error("CONTENT_IO_PFB_MISMATCH");}
 const spec=JSON.parse(await readFile(context.pfb.specPath,"utf8"));
 const sources=JSON.parse(await readFile(join(runtimeRoot,"provider-sources.json"),"utf8"));validateProviderSources(sources);
 const verified=[], expectedContract = await contractHash();
 for(const core of spec.cores){
  const source=[...sources.upstreamReleases,...sources.developmentInputs??[]].find(v=>v.id===core.id);
  const directory=join(retrom,".pfb/workspace/core-builds",core.id,"current");await absolutePath(directory);
  verified.push({core, directory, ...await verifyCoreInput(core.id, directory, source, context.repositories.cores[core.id], expectedContract)});
 }
 // No output is created before every required core has passed validation.
 await mkdir(output);const coreRoot=join(dirname(output),"cores");await mkdir(coreRoot);
 for(const entry of verified){const target=join(coreRoot,entry.core.id);await mkdir(target);
  for(const file of entry.expected){if(basename(file)!==file){throw new Error("CONTENT_IO_CANDIDATE_FILES_INVALID");}await copyFile(join(entry.directory,file),join(target,file));}
 }
 const result={schemaVersion:1,pfbId:context.pfb.id,spec:context.pfb.specPath,runtimeOutput:output,cores:verified.map(({core,descriptorSha256,descriptor})=>({id:core.id,descriptorSha256,sourceTreeSha256:descriptor.sourceTreeSha256,adapterAbi:descriptor.adapterAbi}))};
 await atomicJSON(join(dirname(output),"inputs.json"),result);return result;
}
export async function verifyCoreInput(coreId, directory, source, identity, expectedContract) {
  const path=join(directory,"retrom-core-candidate.json"),bytes=await regular(path,65536),descriptor=JSON.parse(bytes);
  if(!source||!identity||descriptor.schemaVersion!==1||descriptor.kind!=="RETROM_CORE_CANDIDATE_V1"||descriptor.coreId!==coreId||descriptor.repository!==source.repository||descriptor.adapterAbi!==source.adapterAbi||
   ["commit","branch","dirty","sourceTreeSha256"].some(key=>descriptor[key]!==identity[key])){throw new Error(`CONTENT_IO_CANDIDATE_IDENTITY_INVALID:${coreId}`);}
  const expected=["retrom-core-candidate.json",...source.assets.map(v=>v.filename)].sort();
  if(JSON.stringify((await readdir(directory)).sort())!==JSON.stringify(expected)||descriptor.files.length!==source.assets.length){throw new Error("CONTENT_IO_CANDIDATE_FILES_INVALID");}
  for(const asset of source.assets){
   const file=descriptor.files.filter(v=>v.filename===asset.filename),data=await regular(join(directory,asset.filename),asset.maxSizeBytes);
   if(file.length!==1||file[0].sizeBytes!==data.length||file[0].sha256!==hash(data)){throw new Error("CONTENT_IO_CANDIDATE_ASSET_INVALID");}
  }
  if (expectedContract) {
    const markers = {ppsspp: ["ppsspp-host.mjs", "ppsspp.worker.mjs"], play: ["disc-device.mjs"], kirikiri2: ["vlfs.js"], mkxp: ["mkxp-z_libretro.js"]}[coreId];
    if (!markers || !/^[a-f0-9]{64}$/u.test(expectedContract)) throw new Error("CONTENT_IO_CANDIDATE_CONTRACT_MISMATCH");
    for (const file of markers) {
      if (!expected.includes(file) || !(await readFile(join(directory, file))).includes(Buffer.from(expectedContract))) {
        throw new Error(`CONTENT_IO_CANDIDATE_CONTRACT_MISMATCH:${coreId}`);
      }
    }
  }
  return {descriptor, descriptorSha256: hash(bytes), expected};
}
async function regular(path,maximum){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>maximum){throw new Error("CONTENT_IO_CANDIDATE_FILES_INVALID");}return readFile(path);}
async function cli(){const args=argumentsFor({env:{type:"string"},output:{type:"string"}},["env","output"]);
 if(args.help){console.log("prepare-candidate-inputs --env <absolute environment.json> --output <new absolute runtime output; parent exists inside this PFB candidates>");return;}
 const environment=JSON.parse(await readFile(await absolutePath(args.env),"utf8"));await absolutePath(args.output,true);console.log(JSON.stringify(await prepareInputs(environment,args.output)));
}
main(import.meta.url,cli);
