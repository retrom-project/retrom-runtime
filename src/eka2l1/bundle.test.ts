import {expect,it} from "vitest";
import {zipSync,strToU8} from "fflate";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {unpackBundle} from "./bundle.js";
function bundle(extra:Record<string,Uint8Array>={},abi="eka2l1-browser-v1"){
  const files={"eka2l1.js":strToU8("factory"),"eka2l1.wasm":new Uint8Array([0,97,115,109]),"eka2l1-browser.mjs":strToU8("api"),"audio-worklet.mjs":strToU8("audio"),"LICENSE":strToU8("license"),...extra};
  return zipSync({...files,"build.json":strToU8(JSON.stringify({adapterAbi:abi,sourceTreeSha256:"a".repeat(64),files:Object.entries(files).map(([path,bytes])=>({path,sizeBytes:bytes.length,sha256:bytesToHex(sha256(bytes))}))}))});
}
it("accepts only the verified core closure, never firmware or escaping paths",()=>{
  expect(unpackBundle(bundle())["eka2l1.wasm"]).toEqual(new Uint8Array([0,97,115,109]));
  expect(()=>unpackBundle(bundle({"../device.rom":new Uint8Array([1])}))).toThrow("EKA2L1_BUNDLE_INVALID");
  expect(()=>unpackBundle(bundle({"device.rom":new Uint8Array([1])}))).toThrow("EKA2L1_BUNDLE_INVALID");
  expect(()=>unpackBundle(bundle({},"other-abi"))).toThrow("EKA2L1_BUNDLE_INVALID");
});
it("rejects byte corruption even when the ZIP itself remains valid",()=>{
  const zip=bundle(),files=unpackBundle(zip);files["eka2l1.js"]=strToU8("changed");
  expect(()=>unpackBundle(zipSync(files))).toThrow("EKA2L1_BUNDLE_INVALID");
});
