import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {RuntimeExitReporter} from "../internal-adapter.js";
import {mountFileSaveCore} from "../provider/file-save-core.js";
import {SiglusContent} from "./content.js";
import {decodeSiglusSave, encodeSiglusSave, siglusSaveFormat} from "./checkpoint.js";
export type SiglusParameters = {projectIndexURL: string; contentDigest: string; runtimeBaseURL: string; language: "original" | "chs"};
export function mountSiglus(parameters: SiglusParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, content: AdapterContentOptions, reportExit: RuntimeExitReporter) {
  return mountFileSaveCore({parameters, target, frameWindow, restore, content, reportExit,
    identity: `${parameters.contentDigest}:${parameters.language}`, project: new SiglusContent(content),
    abi: "siglus-host-v1", prefix: "SIGLUS", displayName: "SiglusEngine",
    assetDirectory: "assets/siglus/", assets: ["siglus.mjs", "siglus_bg.wasm"], entry: "siglus.mjs", registration: "retromSiglus",
    assetArguments: {wasmURL: "siglus_bg.wasm"}, coreOptions: {language: parameters.language},
    codec: {format: siglusSaveFormat, encode: encodeSiglusSave, decode: decodeSiglusSave}});
}
