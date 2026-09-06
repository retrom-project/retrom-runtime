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
