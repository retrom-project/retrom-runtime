import {mountOpenBOR} from "../../openbor/adapter.js";
import {mountPx68k} from "../../px68k/adapter.js";
import {mountWebMSX} from "../../webmsx/adapter.js";
import {mountScummvm} from "../../scummvm/adapter.js";
import {mountRuffle} from "../../ruffle/adapter.js";
import {mountPlay} from "../../play/adapter.js";

import {mountFantasyConsole} from "../../fantasy-console/adapter.js";
import {mountJ2me} from "../../j2me/adapter.js";
import {mountButterscotch} from "../../butterscotch/adapter.js";
import {mountEasyRpg} from "../../easyrpg/adapter.js";
import {mountKirikiri2} from "../../kirikiri/adapter.js";
import {mountMkxp} from "../../mkxp/adapter.js";
import {mountNativeRpg} from "../../native-web/adapter.js";
import {mountOnsYuri} from "../../ons/adapter.js";
import {mountTyranoScript} from "../../tyranoscript/adapter.js";
import {mountWasm4} from "../../wasm4/adapter.js";
import type {MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter} from "../../internal-adapter.js";
import type {AssetIndexV1, LaunchEnvelopeV1} from "../../provider/module-api.js";
import {retromRuntimeProviderDefinition} from "./catalog.js";
import * as parameters from "./target-parameters.js";

export type TargetMountContext = {
  signal?: AbortSignal;
  reportFailure?: (error: Error) => void;
  assetIndex: AssetIndexV1;
  frame: HTMLIFrameElement | undefined;
  frameWindow: Window;
  restorePayload: Uint8Array | null;
  reportProgress: RuntimeProgressReporter;
  reportExitRequested: RuntimeExitReporter;
  onDiagnostic: (diagnostic: {runtime: string; message: string}) => void;
};

export function mountTargetAdapter(
  envelope: LaunchEnvelopeV1,
  target: HTMLElement,
  context: TargetMountContext,
): Promise<MountedRuntimeAdapter> {
  const {declaration, adapter} = resolveAdapter(envelope.runtime.targetId);
  const {frameWindow, restorePayload, reportProgress, reportExitRequested} = context;
  const reportFailure = context.reportFailure ?? (() => undefined);
  switch (adapter.kind) {
  case "OPENBOR_WEB":
    return mountOpenBOR(parameters.openbor(envelope), target, frameWindow, restorePayload, reportProgress, reportFailure, context.signal);
  case "PX68K_WEB":
    return mountPx68k(parameters.px68k(envelope, context.assetIndex), target, frameWindow, restorePayload,
      reportProgress, reportFailure, context.signal);
  case "WEBMSX_WEB":
    return mountWebMSX(parameters.webmsx(envelope), target, frameWindow, restorePayload, reportProgress, context.signal);
  case "RUFFLE_WEB":
    return mountRuffle(parameters.ruffle(envelope), target, frameWindow, restorePayload, reportProgress, context.signal);
  case "PLAY_WEB":
    return mountPlay(parameters.play(envelope, context.assetIndex), target, frameWindow, restorePayload,
      reportFailure, context.signal);
  case "EASYRPG_WEB":
    return mountEasyRpg(parameters.easyRpg(envelope, declaration.implementation), target,
      frameWindow, restorePayload, reportExitRequested);
  case "MKXP_LIBRETRO_WEB":
    return mountMkxp(parameters.mkxp(envelope, declaration.implementation, context.assetIndex), target,
      restorePayload, undefined, context.onDiagnostic, reportProgress, reportExitRequested);
  case "NATIVE_WEB":
    return mountNativeRpg(parameters.nativeRpg(envelope, declaration.implementation), requireFrame(context),
      restorePayload, reportExitRequested);
  case "ONS_YURI_WEB":
    return mountOnsYuri(parameters.ons(envelope), target, frameWindow, restorePayload, reportProgress, reportExitRequested);
  case "KIRIKIRI2_WEB":
    return mountKirikiri2(parameters.kirikiri(envelope), target, frameWindow, restorePayload, reportExitRequested);
  case "BUTTERSCOTCH_WEB":
    return mountButterscotch(parameters.butterscotch(envelope), target, frameWindow, restorePayload,
      reportProgress, reportExitRequested);
  case "TYRANOSCRIPT_WEB":
    return mountTyranoScript(parameters.tyranoScript(envelope), requireFrame(context), restorePayload, reportExitRequested);
  case "J2ME_MINIJVM_WEB":
    return mountJ2me(parameters.j2me(envelope), target, frameWindow, restorePayload, reportProgress,
      reportExitRequested, reportFailure, context.signal);
  case "SCUMMVM_WEB":
    return mountScummvm(parameters.scummvm(envelope), target, frameWindow, restorePayload, reportProgress,
      reportExitRequested, reportFailure, context.signal);

  case "TIC80_WEB":
  case "FAKE08_WEB":
    return mountFantasyConsole(parameters.fantasy(envelope, context.assetIndex), target, frameWindow,
      restorePayload, reportProgress, reportFailure, context.signal);
  case "WASM4_WEB":
    return mountWasm4(parameters.wasm4(envelope), target, frameWindow, restorePayload, reportProgress);
  default: throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");
  }
}

function requireFrame(context: TargetMountContext) {
  if (!context.frame) {throw new Error("PROVIDER_HOST_INVALID");}
  return context.frame;
}

function resolveAdapter(targetId: string) {
  const declaration = retromRuntimeProviderDefinition.targets.find((entry) => entry.id === targetId);
  const adapter = retromRuntimeProviderDefinition.adapters.find((entry) => entry.id === declaration?.adapterId);
  if (!declaration || !adapter) {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
  return {declaration, adapter};
}
