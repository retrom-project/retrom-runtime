// @vitest-environment jsdom
import {expect,it,vi} from "vitest";
import {loadSession} from "./loader.js";
import type {EKA2L1Parameters} from "./core.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
const {loadCoreAsset}=vi.hoisted(()=>({loadCoreAsset:vi.fn(async()=>{throw new Error("verified asset boundary");})}));
vi.mock("../provider/core-assets.js",()=>({loadCoreAsset}));
it("resolves the Host's relative Provider URL before loading verified bytes",async()=>{
  const config={runtimeBaseUrl:"/runtime/providers/retrom-runtime/digest/assets/eka2l1/"} as EKA2L1Parameters;
  const content={} as AdapterContentOptions;
  await expect(loadSession(config,window,document.createElement("canvas"),undefined,content)).rejects.toThrow("verified asset boundary");
  expect(loadCoreAsset).toHaveBeenCalledWith(content,new URL(config.runtimeBaseUrl+"eka2l1-runtime.zip",location.href).href,
    "assets/eka2l1/eka2l1-runtime.zip",64*1024*1024,undefined);
});
