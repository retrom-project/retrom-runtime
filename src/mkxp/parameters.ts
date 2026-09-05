import type {SeekableBlobSource} from "../contract.js";
import type {RpgMakerPositionV1} from "../rpgmaker/contract.js";

export type MkxpParameters = {
  core: {
    jsUrl: string;
    jsSizeBytes: number;
    jsSha256: string;
    wasmUrl: string;
    wasmSizeBytes: number;
    wasmSha256: string;
  };
  runtimeBaseUrl: string;
  projectArchive: SeekableBlobSource;
  rtpArchives: Array<SeekableBlobSource & {declaredName: string}>;
  rgssVersion: 1 | 2 | 3;
  stateBufferBytes: 268435456;
  expectedRestorePosition: RpgMakerPositionV1 | null;
};
