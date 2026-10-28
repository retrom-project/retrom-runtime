/** Complete an authenticated, correlated reply after its owner has taken it out of the pending slot. */
export function completeChannelReply<T extends {type: string; body: Record<string, unknown>}>(
  pending: {timer: number; resolve: (reply: T) => void; reject: (error: Error) => void},
  reply: T, failureCode: string,
) {
  window.clearTimeout(pending.timer);
  if (reply.type === "ERROR") {
    pending.reject(new Error(typeof reply.body.code === "string" ? reply.body.code : failureCode));
  } else {pending.resolve(reply);}
}
