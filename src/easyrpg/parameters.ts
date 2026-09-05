import type {FileTreeSource} from "../contract.js";

export type EasyRpgParameters = {
  sessionId: string;
  engineMode: "rpg2k" | "rpg2k3";
  runtimeBaseUrl: string;
  projectRootUrl: string;
  rtpSource: FileTreeSource | null;
  checkpointSlot: 100;
};
