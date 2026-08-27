export type RpgGeneration =
  | "RPG2000"
  | "RPG2003"
  | "RPGXP"
  | "RPGVX"
  | "RPGVXACE"
  | "RPGMV"
  | "RPGMZ";

export type CheckpointPayloadKind = "RUNTIME_STATE" | "NATIVE_SAVE_BUNDLE";

export type CheckpointUnavailableReason =
  | "NOT_ON_MAP"
  | "SAVE_DISABLED"
  | "MESSAGE_ACTIVE"
  | "EVENT_ACTIVE"
  | "BUSY"
  | "RUNTIME_NOT_READY"
  | "RUNTIME_FAILED"
  | "CHECKPOINT_ALREADY_CREATED"
  | "NETPLAY_UNSUPPORTED";

export type CheckpointAvailability = {
  available: boolean;
  reason: CheckpointUnavailableReason | null;
};

export type RpgPosition = {
  mapId: number;
  playerX: number;
  playerY: number;
  fixtureState: number;
};

export type RuntimeArchive = {
  url: string;
  sha256: string;
  sizeBytes: number;
};

export type EasyRpgAdapterConfig = {
  adapterKind: "EASYRPG_WEB";
  adapterId: "easyrpg-web";
  engineMode: "rpg2k" | "rpg2k3";
  runtimeBaseUrl: string;
  projectRootUrl: string;
  projectIndexUrl: string;
  rtpArchive: { url: string; sha256: string; mountPath: "/data/rtp/2000" | "/data/rtp/2003" } | null;
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
  projectArchive: RuntimeArchive;
  rtpArchives: Array<RuntimeArchive & { declaredName: string }>;
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

export type RpgAdapterConfig = EasyRpgAdapterConfig | MkxpAdapterConfig | NativeWebAdapterConfig;

/** Host-independent input required to start one isolated runtime session. */
export type RpgRuntimeConfig = {
  sessionId: string;
  generation: RpgGeneration;
  validationPurpose: boolean;
  expectedRestorePosition: RpgPosition | null;
  adapter: RpgAdapterConfig;
};

export type RuntimeState =
  | "CREATED"
  | "LOADING"
  | "RUNNING"
  | "PAUSED"
  | "CHECKPOINTING"
  | "EXITING"
  | "EXITED"
  | "FAILED";

export type CheckpointPayload = {
  bytes: Uint8Array;
  payloadKind: CheckpointPayloadKind;
};

export type RuntimeEvent =
  | { type: "READY" }
  | { type: "LOAD_PROGRESS"; loadedBytes: number; totalBytes: number | null }
  | { type: "STATE_CHANGED"; previous: RuntimeState; state: RuntimeState }
  | { type: "CHECKPOINT_AVAILABILITY_CHANGED"; availability: CheckpointAvailability }
  | { type: "FATAL_ERROR"; code: string }
  | { type: "EXIT_REQUESTED" };

export interface RpgRuntime {
  mount(target: HTMLElement): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  checkpoint(): Promise<CheckpointPayload>;
  screenshot(): Promise<Blob>;
  exit(): Promise<void>;
  getState(): RuntimeState;
  getCheckpointAvailability(): CheckpointAvailability;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}
