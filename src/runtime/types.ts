import type {TargetOptionsV1, RuntimeCheckpointV1} from "../provider/module-api.js";
import type {ResourceKind} from "../provider/declarations.js";

export type RPGEngine = "RPG2000" | "RPG2003" | "RPGXP" | "RPGVX" | "RPGVXACE" | "RPGMV" | "RPGMZ";
export type RuntimeContent =
  | {kind: "SINGLE_FILE" | "ARCADE"; entryFile: string}
  | {kind: "DOS_BUNDLE"; entryFile: string; entryPath?: string}
  | {kind: "RPG_MAKER_PROJECT"; entryFile: string; engine: RPGEngine}
  | {kind: "SCUMMVM_PROJECT"}
  | {kind: "ONS_PROJECT" | "KIRIKIRI_PROJECT" | "BUTTERSCOTCH_PROJECT" | "TYRANOSCRIPT_PROJECT" |
      "NXENGINE_PROJECT" | "DAPHNE_PROJECT"; entryFile: string};
export type CoreConfiguration = {parentFiles?: string[]; options?: TargetOptionsV1};
export type RuntimeConfiguration = {content: RuntimeContent; cores?: Record<string, CoreConfiguration>};

/** Files have immutable content identities. Database IDs and host storage paths remain outside configuration. */
export type RuntimeContentFile = {logicalKey: string; name: string; sha256: string; sizeBytes: number};
export type RuntimeDirectory = {platformId: string; defaultCoreId: string; allowedCoreIds: string[]};
export type RuntimeIdentity = {
  coreId: string; providerId: string; targetId: string; coreFingerprint: string; romHash: string;
};
export type SaveContext = RuntimeIdentity & {
  checkpointFormat: string;
  runtimeOptions: TargetOptionsV1;
  content: RuntimeContent;
};
export type ResourcePlan = {
  role: string; kind: ResourceKind; ordinal: number; files: string[];
  entryFile?: string;
  bridgeAssetPath?: string;
  /** Generic host assembly; core selection and project layout remain runtime decisions. */
  encoding?: "ZIP";
  paths?: Record<string, string>;
};
export type RuntimeDraft = {
  userId: string;
  gameId: string;
  context: SaveContext;
  checkpoint: RuntimeCheckpointV1;
  saveId: string | null;
  expectedVersion: number | null;
};

export class RuntimeConfigurationError extends Error {
  constructor(readonly code: string, readonly details: Readonly<Record<string, string>> = {}) {
    super(code); this.name = "RuntimeConfigurationError";
  }
}
