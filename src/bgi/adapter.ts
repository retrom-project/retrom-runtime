import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {RuntimeExitReporter} from "../internal-adapter.js";
import {mountFileSaveCore} from "../provider/file-save-core.js";
import {IndexedProjectContent} from "../provider/indexed-project-content.js";
import {decodeBgiSave, encodeBgiSave, bgiSaveFormat} from "./checkpoint.js";
export type BgiParameters = {projectIndexURL: string; contentDigest: string; runtimeBaseURL: string; textEncoding: "cp932" | "gbk"};
export function mountBgi(parameters: BgiParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, content: AdapterContentOptions, reportExit: RuntimeExitReporter) {
  return mountFileSaveCore({parameters, target, frameWindow, restore, content, reportExit,
    identity: parameters.contentDigest, project: new IndexedProjectContent(content, "BGI_PROJECT_INDEX_INVALID"),
    abi: "ethornell-host-v1", prefix: "BGI", displayName: "BGI / Ethornell",
    assetDirectory: "assets/ethornell/", entry: "ethornell.mjs", registration: "retromEthornell",
    assets: ["ethornell.mjs", "ethornell-worker.mjs", "ethornell_bg.wasm", "audio-worklet.mjs", "font.ttf"],
    assetArguments: {wasmURL: "ethornell_bg.wasm", workerURL: "ethornell-worker.mjs", fontURL: "font.ttf", audioWorkletURL: "audio-worklet.mjs"},
    coreOptions: {textEncoding: parameters.textEncoding},
    codec: {format: bgiSaveFormat, encode: encodeBgiSave, decode: decodeBgiSave}});
}
