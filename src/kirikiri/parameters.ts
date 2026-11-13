import type {KirikiriEngineMode} from "./engine-mode.js";
export type KirikiriParameters = {
  contentDigest: string;
  runtimeBaseUrl: string;
  projectIndexUrl: string;
  startupXp3Path: string | null;
  engineMode: KirikiriEngineMode;
  overlayRoot: string | null;
  overlayArchives: string[];
  engineArguments: string[];
  steamService: "DISABLED" | "LOCAL";
};
