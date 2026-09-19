export type OnsScriptEncoding = "gbk" | "sjis" | "utf8";

export type OnsParameters = {
  runtimeBaseUrl: string;
  contentDigest: string;
  projectIndexUrl: string;
  scriptEncoding: OnsScriptEncoding;
  checkpointSlot: 999;
};
