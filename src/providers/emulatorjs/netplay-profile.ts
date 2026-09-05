import type {LaunchEnvelopeV1} from "../../provider/module-api.js";

export type EmulatorJsNetplayProfileDeclaration = {
  id: string;
  maxPlayers: 2;
  maxPredictionFrames: 0 | 8;
};

export const emulatorJsNetplayProfiles: Readonly<Record<string, EmulatorJsNetplayProfileDeclaration>> =
  Object.freeze({
    fbalpha2012_cps1: profile("fbalpha2012-cps1-423-v1", 0),
    fbalpha2012_cps2: profile("fbalpha2012-cps2-423-v1", 0),
    fbneo: profile("fbneo-423-v1", 0),
    fceumm: profile("fceumm-423-v1", 8),
    mame2003: profile("mame2003-423-override-v1", 0),
    mame2003_plus: profile("mame2003-plus-423-v1", 0),
    nestopia: profile("nestopia-423-v1", 0),
    snes9x: profile("snes9x-423-v1", 0),
  });

export type ValidatedEmulatorJsNetplayProfile = {
  defaultCoreOptions: Record<string, string>;
  maxStateBytes: number;
  profileId: string;
};

export function validateEmulatorJsNetplayProfile(
  envelope: LaunchEnvelopeV1,
  implementation: {
    coreSha256: string;
    defaultOptions: Readonly<Record<string, string>>;
    netplayProfile: EmulatorJsNetplayProfileDeclaration | null;
    release: string;
  },
): ValidatedEmulatorJsNetplayProfile | null {
  if (envelope.netplay === null) {
    if (envelope.session.mode !== "SINGLE") {throw invalid();}
    return null;
  }
  const declaration = implementation.netplayProfile;
  const value = envelope.netplay.profile;
  if (!declaration || !validEnvelopeMode(envelope, declaration) || !isRecord(value) || !exactProfileKeys(value) ||
    !validIdentity(value, envelope, implementation, declaration) || !validLimits(value, declaration) ||
    !validPlatformIds(value.platformIds)) {throw invalid();}
  return {
    defaultCoreOptions: {...implementation.defaultOptions},
    maxStateBytes: value.maxStateBytes as number,
    profileId: declaration.id,
  };
}

function validEnvelopeMode(envelope: LaunchEnvelopeV1, declaration: EmulatorJsNetplayProfileDeclaration) {
  return envelope.session.mode === "NETPLAY" && envelope.netplay !== null &&
    envelope.netplay.playerNo <= declaration.maxPlayers;
}
function exactProfileKeys(value: Record<string, unknown>) {
  return exactKeys(value, [
    "bundleSha256", "canonicalHistoryFrames", "checkpointEveryFrames", "controlCount", "coreId",
    "dependencySnapshotDigest", "maxPlayers", "maxPredictionFrames", "maxRollbackFrames", "maxStateBytes",
    "platformIds", "profileId", "protocolVersion", "providerId", "schemaVersion", "sourceManifestDigest", "targetId",
  ]);
}
function validIdentity(
  value: Record<string, unknown>,
  envelope: LaunchEnvelopeV1,
  implementation: {release: string},
  declaration: EmulatorJsNetplayProfileDeclaration,
) {
  return implementation.release === "4.2.3" && value.schemaVersion === 2 &&
    value.protocolVersion === "retrom-netplay-v2" && value.profileId === declaration.id &&
    value.providerId === envelope.runtime.providerId && value.targetId === envelope.runtime.targetId &&
    value.bundleSha256 === envelope.runtime.bundleSha256 && nonEmpty(value.coreId) &&
    digest(value.sourceManifestDigest) &&
    digest(value.dependencySnapshotDigest);
}
function validLimits(value: Record<string, unknown>, declaration: EmulatorJsNetplayProfileDeclaration) {
  return value.controlCount === 24 && value.maxPlayers === declaration.maxPlayers &&
    value.maxPredictionFrames === declaration.maxPredictionFrames && value.maxRollbackFrames === 120 &&
    value.checkpointEveryFrames === 120 && value.canonicalHistoryFrames === 600 && value.maxStateBytes === 1_048_576;
}
function validPlatformIds(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => nonEmpty(entry));
}

function profile(id: string, maxPredictionFrames: 0 | 8): EmulatorJsNetplayProfileDeclaration {
  return Object.freeze({id, maxPlayers: 2, maxPredictionFrames});
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function nonEmpty(value: unknown): value is string {return typeof value === "string" && value.length > 0 && value.length <= 256;}
function digest(value: unknown): value is string {return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);}
function invalid() {return new Error("PLAYER_NETPLAY_PROFILE_INVALID");}
