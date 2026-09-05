export type NativeRpgParameters = {
  sessionId: string;
  bridgeProfile: "RPGMV" | "RPGMZ";
  uniqueOrigin: string;
  bootstrapUrl: string;
  bootstrapTicket: string;
  cleanupUrl: string | null;
};
