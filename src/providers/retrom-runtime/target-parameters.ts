import type {PSPParameters} from "../../psp/core.js";
import type {NP2Parameters} from "../../np2kai/adapter.js";
import type {OpenBORParameters} from "../../openbor/adapter.js";
import type {Px68kParameters} from "../../px68k/core.js";
import type {WebMSXParameters} from "../../webmsx/adapter.js";
import scummvmLayout from "../../scummvm/core-layout.json" with {type: "json"};
import type {ScummvmParameters} from "../../scummvm/parameters.js";
import type {PlayParameters} from "../../play/core.js";

export function play(envelope: LaunchEnvelopeV1, assetIndex: AssetIndexV1): PlayParameters {
  const game = resource(envelope, "game", "SEEKABLE_BLOB");
  return {disc: seekableSource(game), runtimeBaseUrl: assetBase(envelope, "play"), assetIndex};
}
import type {FantasyParameters} from "../../fantasy-console/core.js";
import type {J2meParameters} from "../../j2me/parameters.js";
import type {FileTreeSource, SeekableBlobSource} from "../../contract.js";
import type {AssetIndexV1, LaunchEnvelopeV1, RuntimeResourceV1} from "../../provider/module-api.js";
import type {EasyRpgParameters} from "../../easyrpg/parameters.js";
import type {MkxpParameters} from "../../mkxp/parameters.js";
import type {NativeRpgParameters} from "../../native-web/parameters.js";
import type {OnsParameters} from "../../ons/parameters.js";
import type {KirikiriParameters} from "../../kirikiri/parameters.js";
import type {ButterscotchParameters} from "../../butterscotch/parameters.js";
import type {TyranoScriptParameters} from "../../tyranoscript/parameters.js";
import type {Wasm4Parameters} from "../../wasm4/parameters.js";
import type {RuffleParameters} from "../../ruffle/adapter.js";

export function ruffle(envelope: LaunchEnvelopeV1): RuffleParameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  return {contentDigest: game.sha256, swfSizeBytes: game.sizeBytes,
    swfUrl: game.url, runtimeBaseUrl: assetBase(envelope, "ruffle")};
}

export function easyRpg(envelope: LaunchEnvelopeV1, implementation: Readonly<Record<string, unknown>>): EasyRpgParameters {
  const game = resource(envelope, "game", "FILE_TREE");
  const rtp = optionalResource(envelope, "rtp", "FILE_TREE");
  if (implementation.engineMode !== "rpg2k" && implementation.engineMode !== "rpg2k3") {invalidRequest();}
  return {
    sessionId: envelope.session.id,
    checkpointSlot: 100,
    engineMode: implementation.engineMode,
    projectRootUrl: rootFromIndex(game.indexUrl),
    rtpSource: rtp ? fileTreeSource(rtp) : null,
    runtimeBaseUrl: assetBase(envelope, "easyrpg"),
  };
}

export function mkxp(
  envelope: LaunchEnvelopeV1,
  implementation: Readonly<Record<string, unknown>>,
  assetIndex: AssetIndexV1,
): MkxpParameters {
  const game = resource(envelope, "game", "SEEKABLE_BLOB");
  const jsPath = "assets/mkxp/mkxp-z_libretro.js";
  const wasmPath = "assets/mkxp/mkxp-z_libretro.wasm";
  const js = assetIndex[jsPath];
  const wasm = assetIndex[wasmPath];
  if (!js || !wasm || ![1, 2, 3].includes(Number(implementation.rgssVersion))) {invalidRequest();}
  const rgssVersion = implementation.rgssVersion as 1 | 2 | 3;
  return {
    core: {
        jsSha256: js.sha256,
        jsSizeBytes: js.sizeBytes,
        jsUrl: `${envelope.runtime.runtimeBaseUrl}${jsPath}`,
        wasmSha256: wasm.sha256,
        wasmSizeBytes: wasm.sizeBytes,
        wasmUrl: `${envelope.runtime.runtimeBaseUrl}${wasmPath}`,
      },
    projectArchive: seekableSource(game),
    rgssVersion,
    rtpArchives: resources(envelope, "rtp", "SEEKABLE_BLOB").map((entry) => ({
        ...seekableSource(entry), declaredName: `rtp-${entry.ordinal}`,
      })),
    runtimeBaseUrl: assetBase(envelope, "mkxp"),
    stateBufferBytes: 268435456,
  };
}

export function nativeRpg(
  envelope: LaunchEnvelopeV1,
  implementation: Readonly<Record<string, unknown>>,
): NativeRpgParameters {
  const game = resource(envelope, "game", "NATIVE_WEB");
  if (implementation.bridgeProfile !== "RPGMV" && implementation.bridgeProfile !== "RPGMZ") {invalidRequest();}
  return {
    sessionId: envelope.session.id,
    bootstrapTicket: game.bootstrapTicket,
    bootstrapUrl: game.entryUrl,
    bridgeProfile: implementation.bridgeProfile,
    cleanupUrl: game.cleanupUrl,
    uniqueOrigin: game.origin,
  };
}

export function ons(envelope: LaunchEnvelopeV1): OnsParameters {
  const game = resource(envelope, "game", "FILE_TREE");
  const encoding = envelope.targetOptions.scriptEncoding;
  if (encoding !== "gbk" && encoding !== "sjis" && encoding !== "utf8") {invalidRequest();}
  return {
    checkpointSlot: 999,
    projectIndexUrl: game.indexUrl,
    runtimeBaseUrl: assetBase(envelope, "ons"),
    scriptEncoding: encoding,
  };
}

export function kirikiri(envelope: LaunchEnvelopeV1): KirikiriParameters {
  const game = resource(envelope, "game", "FILE_TREE");
  const startupXp3Path = envelope.targetOptions.startupXp3Path;
  if (startupXp3Path !== null && typeof startupXp3Path !== "string") {invalidRequest();}
  return {
    checkpointSlot: 1999,
    projectIndexUrl: game.indexUrl,
    runtimeBaseUrl: assetBase(envelope, "kirikiri"),
    startupXp3Path,
  };
}

export function butterscotch(envelope: LaunchEnvelopeV1): ButterscotchParameters {
  const game = resource(envelope, "game", "FILE_TREE");
  return {
    contentDigest: game.contentDigest,
    sessionId: envelope.session.id,
    projectIndexUrl: game.indexUrl,
    runtimeBaseUrl: assetBase(envelope, "butterscotch"),
  };
}

export function tyranoScript(envelope: LaunchEnvelopeV1): TyranoScriptParameters {
  const game = resource(envelope, "game", "ISOLATED_WEB");
  return {
    sessionId: envelope.session.id,
    bootstrapTicket: game.bootstrapTicket,
    cleanupUrl: game.cleanupUrl,
    entryUrl: game.entryUrl,
    uniqueOrigin: game.origin,
  };
}

export function j2me(envelope: LaunchEnvelopeV1): J2meParameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  return {sessionId: envelope.session.id, contentDigest: game.sha256, jarSizeBytes: game.sizeBytes,
    jarUrl: game.url, runtimeBaseUrl: assetBase(envelope, "j2me")};
}

export function scummvm(envelope: LaunchEnvelopeV1): ScummvmParameters {
  const game = resource(envelope, "game", "FILE_TREE");
  const options = envelope.targetOptions;
  if (typeof options.engineId !== "string" || !scummvmLayout.engines.includes(options.engineId)) {invalidRequest();}
  const text = (key: string): string => {if (typeof options[key] !== "string") {invalidRequest();} return options[key];};
  const filename = options.filename;
  if (filename !== null && typeof filename !== "string") {invalidRequest();}
  return {contentDigest: game.contentDigest, projectIndexUrl: game.indexUrl, runtimeBaseUrl: assetBase(envelope, "scummvm"),
    selection: {engineId: text("engineId"), gameId: text("gameId"), root: text("root"), language: text("language"),
      platform: text("platform"), extra: text("extra"), guiOptions: text("guiOptions"), filename}};
}

export function fantasy(envelope: LaunchEnvelopeV1, assetIndex: AssetIndexV1): FantasyParameters {
  const core = envelope.runtime.targetId;
  if (core !== "tic80" && core !== "fake08") {invalidRequest();}
  const game = resource(envelope, "game", "ROM_BLOB");
  return {core, cartSizeBytes: game.sizeBytes, contentDigest: game.sha256, cartUrl: game.url,
    runtimeBaseUrl: envelope.runtime.runtimeBaseUrl, assetIndex};
}

export function wasm4(envelope: LaunchEnvelopeV1): Wasm4Parameters {
  const game = resource(envelope, "game", "WASM4_CART");
  return {
    cartSizeBytes: game.sizeBytes,
    contentDigest: game.sha256,
    cartUrl: game.url,
    runtimeBaseUrl: assetBase(envelope, "wasm4"),
  };
}

function resource<Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: string,
  kind: Kind,
): RuntimeResourceOfKind<Kind> {
  const matches = resources(envelope, role, kind);
  if (matches.length !== 1) {invalidRequest();}
  return matches[0];
}

function optionalResource<Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: string,
  kind: Kind,
) {
  const matches = resources(envelope, role, kind);
  if (matches.length > 1) {invalidRequest();}
  return matches[0] ?? null;
}

function resources<Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: string,
  kind: Kind,
) {
  return envelope.resources.filter(
    (entry): entry is RuntimeResourceOfKind<Kind> => entry.role === role && entry.kind === kind,
  );
}

type RuntimeResourceOfKind<Kind extends RuntimeResourceV1["kind"]> = RuntimeResourceV1 & {kind: Kind};

function rootFromIndex(indexUrl: string) {
  if (!indexUrl.endsWith("/index.json")) {invalidRequest();}
  return indexUrl.slice(0, -"index.json".length);
}

function fileTreeSource(resourceValue: RuntimeResourceOfKind<"FILE_TREE">): FileTreeSource {
  return {kind: "FILE_TREE", indexUrl: resourceValue.indexUrl};
}

function seekableSource(resourceValue: RuntimeResourceOfKind<"SEEKABLE_BLOB">): SeekableBlobSource {
  return {
    kind: "SEEKABLE_BLOB", rangeRequired: true, sha256: resourceValue.sha256,
    sizeBytes: resourceValue.sizeBytes, url: resourceValue.url,
  };
}

function assetBase(envelope: LaunchEnvelopeV1, directory: string) {
  return `${envelope.runtime.runtimeBaseUrl}assets/${directory}/`;
}

function invalidRequest(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}

export function np2kai(envelope: LaunchEnvelopeV1, assetIndex: AssetIndexV1): NP2Parameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  return {disk: {url: game.url, sha256: game.sha256, sizeBytes: game.sizeBytes},
    runtimeBaseUrl: assetBase(envelope, "np2kai"), assetIndex};
}

export function openbor(envelope: LaunchEnvelopeV1): OpenBORParameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  return {pak: {url: game.url, sizeBytes: game.sizeBytes, sha256: game.sha256}, runtimeBaseUrl: assetBase(envelope, "openbor")};
}

export function px68k(envelope: LaunchEnvelopeV1, assetIndex: AssetIndexV1): Px68kParameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  const bios = resource(envelope, "external", "EXTERNAL_FILE_SET");
  return {game, bios: bios.files, runtimeBaseUrl: envelope.runtime.runtimeBaseUrl, assetIndex};
}

export function webmsx(envelope: LaunchEnvelopeV1): WebMSXParameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  return {mediaUrl: game.url, mediaSizeBytes: game.sizeBytes, contentDigest: game.sha256,
    runtimeBaseUrl: assetBase(envelope, "webmsx")};
}

export function psp(envelope: LaunchEnvelopeV1, assetIndex: AssetIndexV1): PSPParameters {
  const game = resource(envelope, "game", "ROM_BLOB");
  return {game: {url: game.url, sha256: game.sha256, sizeBytes: game.sizeBytes},
    runtimeBaseUrl: assetBase(envelope, "ppsspp"), assetIndex};
}
