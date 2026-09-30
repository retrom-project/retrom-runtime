import {unzipSync} from "fflate";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
const required=["eka2l1.js","eka2l1.wasm","eka2l1-browser.mjs","audio-worklet.mjs","LICENSE","build.json"];
const allowed=(path:string)=>required.includes(path)||/^(resources\/(?:web\/)?[a-zA-Z0-9_]+\.(?:frag|vert)|patch\/[a-zA-Z0-9_.]+\.(?:dll|map))$/u.test(path);
export function unpackBundle(bytes:Uint8Array):Record<string,Uint8Array>{
  try{
    let total=0;
    const files=unzipSync(bytes,{filter(file){
      total+=file.originalSize;
      if(!allowed(file.name)||file.originalSize>128*1024*1024||total>256*1024*1024)throw new Error("invalid closure");return true;
    }});
    if(required.some(path=>!files[path]?.byteLength))throw new Error("missing file");
    const metadata:unknown=JSON.parse(new TextDecoder().decode(files["build.json"]));
    if(!validMetadata(metadata))throw new Error("invalid ABI");
    const seen=new Set<string>();
    for(const item of metadata.files){
      if(!validFile(item)||seen.has(item.path)||item.path==="build.json")throw new Error("invalid manifest");
      const value=files[item.path];
      if(!value||value.length!==item.sizeBytes||bytesToHex(sha256(value))!==item.sha256)throw new Error("invalid hash");seen.add(item.path);
    }
    if(seen.size!==Object.keys(files).length-1)throw new Error("incomplete closure");
    return files;
  }catch(cause){throw new Error("EKA2L1_BUNDLE_INVALID",{cause});}
}
function validMetadata(value:unknown):value is {files:unknown[]}{
  if(!value||typeof value!=="object")return false;
  const item=value as Record<string,unknown>;
  return item.adapterAbi==="eka2l1-browser-v1"&&typeof item.sourceTreeSha256==="string"&&/^[0-9a-f]{64}$/u.test(item.sourceTreeSha256)&&Array.isArray(item.files);
}
function validFile(value:unknown):value is {path:string;sizeBytes:number;sha256:string}{
  if(!value||typeof value!=="object")return false;
  const item=value as Record<string,unknown>;
  return typeof item.path==="string"&&allowed(item.path)&&Number.isSafeInteger(item.sizeBytes)&&Number(item.sizeBytes)>=0&&typeof item.sha256==="string"&&/^[0-9a-f]{64}$/u.test(item.sha256);
}
