import type {ContentInputPolicyV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import {contentLimits as limits} from "../content-io/limits.js";

export const contentBoundaries = Object.freeze({
  "native-web": "src/native/adapter.ts",
  "tyranoscript-frame": "src/tyranoscript/adapter.ts",
  "easyrpg-loader": "src/easyrpg/adapter.ts",
  "j2me-loader": "src/j2me/adapter.ts",
  "emulatorjs-loader": "src/providers/emulatorjs/provider-runtime.ts",
});
export function rangePolicy(bridge: Exclude<ManagedInputPolicyV1["bridge"], "NONE">, maxFileBytes: number,
  overrides: Partial<Pick<ManagedInputPolicyV1, "contentLengthPolicy" | "writes">> = {}): ManagedInputPolicyV1 {
  return {mode: "RANGE", bridge, result: "READER", maxFileBytes, workspace: "NONE", writes: "DENY",
    contentLengthPolicy: "EXACT_IF_PRESENT",  ...overrides};
}
export function eagerPolicy(maxFileBytes: number,
  overrides: Partial<Pick<ManagedInputPolicyV1, "mode" | "result" | "workspace" | "writes">> = {}): ManagedInputPolicyV1 {
  return {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes, workspace: "NONE", writes: "DENY",
    contentLengthPolicy: "EXACT_IF_PRESENT",  ...overrides};
}
const upstream = (boundaryId: keyof typeof contentBoundaries): ContentInputPolicyV1 => ({mode: "UPSTREAM_LOADER", boundaryId});
const native = (boundaryId: keyof typeof contentBoundaries): ContentInputPolicyV1 => ({mode: "BROWSER_NATIVE", boundaryId});
const mkxp = rangePolicy("WASMFS", limits.indexedFile, {writes: "SESSION_OVERLAY"});
const gamePolicies: Readonly<Record<string, ContentInputPolicyV1>> = {
  "butterscotch-gamemaker": eagerPolicy(limits.indexedFile, {result: "WORKSPACE_FILE", workspace: "OPFS_REQUIRED", writes: "SESSION_OVERLAY"}),
  fake08: eagerPolicy(limits.fantasyFile),
  "flash-ruffle": eagerPolicy(limits.ruffleSwf),
  j2me: upstream("j2me-loader"),
  "bbc-jsbeeb": eagerPolicy(32 * 1024 * 1024),
  "kirikiri2-kag": rangePolicy("VLFS", limits.indexedFile, { writes: "SESSION_OVERLAY"}),
  "msx-webmsx": eagerPolicy(limits.webmsxMedia),
  nxengine: eagerPolicy(limits.nxengineFile),
  "onscripter-yuri": eagerPolicy(limits.indexedFile, {mode: "ON_OPEN"}),
  openbor: eagerPolicy(limits.openborPak),
  "rpgmaker-2000": upstream("easyrpg-loader"),
  "rpgmaker-2003": upstream("easyrpg-loader"),
  "rpgmaker-mv": native("native-web"),
  "rpgmaker-mz": native("native-web"),
  "rpgmaker-vx": mkxp,
  "rpgmaker-vx-ace": mkxp,
  "rpgmaker-xp": mkxp,
  tic80: eagerPolicy(limits.fantasyFile),
  tyranoscript: native("tyranoscript-frame"),
  wasm4: eagerPolicy(limits.wasm4Cart),
};
export function runtimeGamePolicy(id: string): ContentInputPolicyV1 {
  const policy = gamePolicies[id];
  if (!policy) {throw new Error("PROVIDER_CONTENT_POLICY_MISSING");}
  return {...policy};
}
export function emulatorContentPolicies(core: string): Readonly<Record<string, ContentInputPolicyV1>> {
  const game = core === "neocd" ? rangePolicy("ASYNC", limits.signedDisc) :
    core === "flycast" ? eagerPolicy(limits.signedDisc, {result: "BLOB"}) : upstream("emulatorjs-loader");
  return {game, discs: {...game}, bios: upstream("emulatorjs-loader"), parent: upstream("emulatorjs-loader"), external: upstream("emulatorjs-loader")};
}
