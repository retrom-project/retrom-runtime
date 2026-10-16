import {withStartupTask} from "../../provider/startup.js";
import {mountWithNativeContent} from "../../native-web/content-bridge.js";
import {mountMame} from "../../mame/adapter.js";
import {bindTargetContent} from "../../provider/target-content.js";
import {requireContentSession} from "../../provider/content-inputs.js";
import {mountGBE} from "../../gbe-pokemini/adapter.js";
import {mountNXEngine} from "../../nxengine/adapter.js";
import {mountNP2} from "../../np2kai/adapter.js";
import {mountOpenBOR} from "../../openbor/adapter.js";
import {mountPx68k} from "../../px68k/adapter.js";
import {mountWebMSX} from "../../webmsx/adapter.js";
import {mountJsbeeb} from "../../jsbeeb/adapter.js";
import {mountApple2} from "../../apple2js/adapter.js";
import {mountSamCoupe} from "../../samcoupe/adapter.js";
import {mountScummvm} from "../../scummvm/adapter.js";
import {mountRuffle} from "../../ruffle/adapter.js";
import {mountPSP} from "../../psp/adapter.js";
import {mountPlay} from "../../play/adapter.js";
import {mountShiina} from "../../openshiina/adapter.js";

import {mountFantasyConsole} from "../../fantasy-console/adapter.js";
import {mountJ2me} from "../../j2me/adapter.js";
import {mountButterscotch} from "../../butterscotch/adapter.js";
import {mountWithEasyRpgContent} from "./easyrpg-content.js";
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

import type {ContentSessionClient} from "../../content-io/client.js";
export type TargetMountContext = {
  startup?: import("../../provider/startup.js").StartupTasks;
  contentSession?: ContentSessionClient | null;
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
  input: TargetMountContext,
): Promise<MountedRuntimeAdapter> {
  return withStartupTask(input.startup, "CORE_INITIALIZATION", () => mountAdapter(envelope, target, input), {summary: true});
}

function mountAdapter(envelope: LaunchEnvelopeV1, target: HTMLElement, input: TargetMountContext): Promise<MountedRuntimeAdapter> {
  const {declaration, adapter} = resolveAdapter(envelope.runtime.targetId);
  const contentSession = input.contentSession ? bindTargetContent(input.contentSession, declaration, input.startup) : null;
  const context = {...input, contentSession, content: contentSession ? {
    contentSession, assetIndex: input.assetIndex, signal: input.signal, startup: input.startup,
    reportProgress: input.reportProgress, onFailure: failureReporter(input), runtimeBaseURL: envelope.runtime.runtimeBaseUrl,
  } : null};
  const {frameWindow, restorePayload, reportProgress, reportExitRequested} = context;
  const reportFailure = failureReporter(context);
  const mounts: Record<string, () => Promise<MountedRuntimeAdapter>> = {
    SHIINA_WEB: () => mountShiina(parameters.shiina(envelope), target, frameWindow, restorePayload, reportProgress, reportFailure,
      reportExitRequested, contentOptions(context)),
    NXENGINE_WEB: () => mountNXEngine(parameters.nxengine(envelope, context.assetIndex), target, frameWindow, restorePayload, reportProgress, reportFailure, context.signal, undefined, contentOptions(context)),
    OPENBOR_WEB: () => mountOpenBOR(parameters.openbor(envelope), target, frameWindow, restorePayload, reportProgress, reportFailure, context.signal, contentOptions(context)),
    RUFFLE_WEB: () => mountRuffle(parameters.ruffle(envelope), target, frameWindow, restorePayload, reportProgress, context.signal, undefined, contentOptions(context)),
    EASYRPG_WEB: () => mountWithEasyRpgContent(envelope, frameWindow, requireContentSession(contentSession), requireStartupSignal(context),
      () => mountEasyRpg(parameters.easyRpg(envelope, declaration.implementation), target,
        frameWindow, restorePayload, {signal: requireStartupSignal(context), reportExitRequested, tasks: context.startup})),
    MKXP_LIBRETRO_WEB: () => mountMkxp(parameters.mkxp(envelope, declaration.implementation, context.assetIndex), target,
      restorePayload, undefined, context.onDiagnostic, reportProgress, reportExitRequested,
      {...contentOptions(context), signal: context.signal, onFailure: reportFailure}),
    NATIVE_WEB: () => mountWithNativeContent(envelope, requireFrame(context), requireContentSession(contentSession),
      (loading, pluginFiles) => mountNativeRpg(parameters.nativeRpg(envelope, declaration.implementation), requireFrame(context),
        restorePayload, reportExitRequested, {loading, signal: context.signal}, pluginFiles), context.signal, reportFailure),
    ONS_YURI_WEB: () => mountOnsYuri(parameters.ons(envelope), target, frameWindow, restorePayload, reportProgress, reportExitRequested,
      {...contentOptions(context), signal: context.signal, onFailure: reportFailure}),
    KIRIKIRI2_WEB: () => mountKirikiri2(parameters.kirikiri(envelope), target, frameWindow, restorePayload, reportExitRequested,
      contentOptions(context)),
    BUTTERSCOTCH_WEB: () => mountButterscotch(parameters.butterscotch(envelope), target, frameWindow, restorePayload,
      reportProgress, reportExitRequested, {...contentOptions(context), signal: context.signal}),
    TYRANOSCRIPT_WEB: () => mountWithNativeContent(envelope, requireFrame(context), requireContentSession(contentSession),
      () => mountTyranoScript(parameters.tyranoScript(envelope), requireFrame(context), restorePayload, reportExitRequested),
      context.signal, reportFailure),
    J2ME_MINIJVM_WEB: () => mountJ2me(parameters.j2me(envelope), target, frameWindow, restorePayload, reportProgress,
      reportExitRequested, reportFailure, context.signal, undefined, input.startup),
    SCUMMVM_WEB: () => mountScummvm(parameters.scummvm(envelope), target, frameWindow, restorePayload, reportProgress,
      reportExitRequested, reportFailure, context.signal, undefined, contentOptions(context)),
    TIC80_WEB: () => mountFantasyConsole(parameters.fantasy(envelope, context.assetIndex), target, frameWindow,
      restorePayload, reportProgress, reportFailure, context.signal, undefined, contentOptions(context)),
    WASM4_WEB: () => mountWasm4(parameters.wasm4(envelope), target, frameWindow, restorePayload, reportProgress, undefined, {...contentOptions(context), signal: context.signal}),
  };
  mounts.FAKE08_WEB = mounts.TIC80_WEB;
  const mount = mounts[adapter.kind];
  return mount ? mount() : mountMachineAdapter(adapter.kind, envelope, target, context);
}

function failureReporter(context: Pick<TargetMountContext, "reportFailure">) {
  return context.reportFailure ?? (() => undefined);
}

function requireFrame(context: Pick<TargetMountContext, "frame">) {
  if (!context.frame) {throw new Error("PROVIDER_HOST_INVALID");}
  return context.frame;
}

function resolveAdapter(targetId: string) {
  const declaration = retromRuntimeProviderDefinition.targets.find((entry) => entry.id === targetId);
  const adapter = retromRuntimeProviderDefinition.adapters.find((entry) => entry.id === declaration?.adapterId);
  if (!declaration || !adapter) {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
  return {declaration, adapter};
}

function mountMachineAdapter(kind: string, envelope: LaunchEnvelopeV1, target: HTMLElement, context: BoundMountContext) {
  const {frameWindow, restorePayload, reportProgress} = context;
  const reportFailure = context.reportFailure ?? (() => undefined);
  switch (kind) {
  case "MAME_DYLINK":
    return mountMame(parameters.mame(envelope), target, frameWindow, restorePayload, {...contentOptions(context), signal: context.signal, reportProgress, onFailure: reportFailure});
  case "GBE_POKEMINI_WEB":
    return mountGBE(parameters.gbePokemini(envelope, context.assetIndex), target, frameWindow, restorePayload, reportProgress, context.signal, undefined, contentOptions(context));
  case "NP2KAI_WEB":
    return mountNP2(parameters.np2kai(envelope, context.assetIndex), target, frameWindow, restorePayload,
      reportProgress, reportFailure, context.signal, undefined, contentOptions(context));
  case "PX68K_WEB":
    return mountPx68k(parameters.px68k(envelope, context.assetIndex), target, frameWindow, restorePayload,
      reportProgress, reportFailure, context.signal, undefined, contentOptions(context));
  case "WEBMSX_WEB":
    return mountWebMSX(parameters.webmsx(envelope), target, frameWindow, restorePayload, reportProgress, context.signal, undefined, contentOptions(context));
  case "PPSSPP_WEB":
    return mountPSP(parameters.psp(envelope, context.assetIndex), target, frameWindow, restorePayload,
      reportProgress, reportFailure, context.signal, {}, contentOptions(context));
  case "PLAY_WEB":
    return mountPlay(parameters.play(envelope, context.assetIndex), target, frameWindow, restorePayload,
      reportFailure, context.signal, undefined, contentOptions(context));

  case "JSBEEB_WEB":
    return mountJsbeeb(parameters.jsbeeb(envelope), target, frameWindow, restorePayload, reportProgress,
      requireContentSession(context.contentSession), context.signal);
  case "APPLE2JS_WEB":
    return mountApple2(parameters.apple2js(envelope), target, frameWindow, restorePayload, reportProgress,
      requireContentSession(context.contentSession), context.signal);
  case "SAMCOUPE_WEB":
    return mountSamCoupe(parameters.samcoupe(envelope), target, frameWindow, restorePayload, reportProgress,
      contentOptions(context), reportFailure, context.signal);
  default: throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");
  }
}

type BoundMountContext = Omit<TargetMountContext, "contentSession"> & {
  contentSession: BoundSession | null;
  content: (import("../../provider/content-inputs.js").AdapterContentOptions & {
    contentSession: BoundSession; runtimeBaseURL: string;
  }) | null;
};
type BoundSession = import("../../provider/content-inputs.js").AdapterContentSession & Pick<ContentSessionClient, "createSyncChannel">;
function contentOptions(context: BoundMountContext) {
  if (!context.content) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  return context.content;
}

function requireStartupSignal(context: {signal?: AbortSignal}): AbortSignal {
  if (!context.signal) {throw new Error("PLAYER_RUNTIME_CONTRACT_INVALID");}
  return context.signal;
}
