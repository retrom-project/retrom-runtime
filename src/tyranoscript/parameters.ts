export type TyranoScriptParameters = {
  sessionId: string;
  bootstrapTicket: string;
  cleanupUrl: string | null;
  entryUrl: string;
  uniqueOrigin: string;
};
