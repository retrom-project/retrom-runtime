import type {ButterscotchGamepadMode} from "./gamepads.js";

export type ButterscotchParameters = {
  gamepadMode?: ButterscotchGamepadMode;
  sessionId: string;
  contentDigest: string;
  projectIndexUrl: string;
  runtimeBaseUrl: string;
};
