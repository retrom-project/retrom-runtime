import type { FileTreeSource, SeekableBlobSource } from "../contract.js";

export type RpgMakerGeneration =
  | "RPG2000"
  | "RPG2003"
  | "RPGXP"
  | "RPGVX"
  | "RPGVXACE"
  | "RPGMV"
  | "RPGMZ";

export type RpgMakerPositionV1 = {
  mapId: number;
  playerX: number;
  playerY: number;
  fixtureState: number;
};

export const rpgMakerPositionProbeKind = "rpgmaker.position.v1";

export type EasyRpgAdapterConfig = {
  adapterKind: "EASYRPG_WEB";
  adapterId: "easyrpg-web";
  engineMode: "rpg2k" | "rpg2k3";
  runtimeBaseUrl: string;
  projectRootUrl: string;
  projectIndexUrl: string;
  rtpSource: FileTreeSource | null;
  checkpointSlot: 100;
};

export type MkxpAdapterConfig = {
  adapterKind: "MKXP_LIBRETRO_WEB";
  adapterId: "mkxp-libretro-web";
  core: {
    jsUrl: string;
    jsSizeBytes: number;
    jsSha256: string;
    wasmUrl: string;
    wasmSizeBytes: number;
    wasmSha256: string;
    artifactSetSha256: string;
  };
  runtimeBaseUrl: string;
  projectArchive: SeekableBlobSource;
  rtpArchives: Array<SeekableBlobSource & { declaredName: string }>;
  rgssVersion: 1 | 2 | 3;
  stateBufferBytes: 268435456;
};

export type NativeWebAdapterConfig = {
  adapterKind: "NATIVE_WEB";
  adapterId: "native-web";
  bridgeProfile: "RPGMV" | "RPGMZ";
  uniqueOrigin: string;
  bootstrapUrl: string;
  bootstrapTicket: string;
  cleanupUrl: string | null;
};

export type RpgMakerAdapterConfig = EasyRpgAdapterConfig | MkxpAdapterConfig | NativeWebAdapterConfig;

export type RpgMakerRuntimeConfig = {
  sessionId: string;
  generation: RpgMakerGeneration;
  validationPurpose: boolean;
  expectedRestorePosition: RpgMakerPositionV1 | null;
  adapter: RpgMakerAdapterConfig;
};
