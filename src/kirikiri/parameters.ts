export type KirikiriParameters = {
  contentDigest: string;
  runtimeBaseUrl: string;
  projectIndexUrl: string;
  startupXp3Path: string | null;
  engineMode: "KIRIKIRI2" | "KIRIKIRI_Z";
  overlayRoot: string | null;
  engineArguments: string[];
  steamService: "DISABLED" | "LOCAL";
};
