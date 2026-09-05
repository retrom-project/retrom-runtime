export type OnsScriptEncoding = "gbk" | "sjis" | "utf8";

export type OnsParameters = {
  runtimeBaseUrl: string;
  projectIndexUrl: string;
  scriptEncoding: OnsScriptEncoding;
  checkpointSlot: 999;
};
