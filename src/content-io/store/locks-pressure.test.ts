// @vitest-environment node
import {expect, it, vi} from "vitest";
import {ContentLocks} from "./locks.js";
import {namespace} from "./types.js";

it("uses a legal nonblocking use lock and checks cancellation before entering data work", async () => {
  const request = vi.fn(async (_name: string, options: LockOptions, action: (lock: Lock) => Promise<unknown>) => {
    if (options.ifAvailable && options.signal) {throw new DOMException("invalid lock options", "NotSupportedError");}
    return action({name: _name, mode: "exclusive"} as Lock);
  });
  const locks = new ContentLocks({request} as unknown as LockManager), work = vi.fn(async () => 17);
  await expect(locks.gc("key", work, new AbortController().signal)).resolves.toBe(17);
  expect(request).toHaveBeenCalledWith(`${namespace}:use:key`, {mode: "exclusive", ifAvailable: true}, expect.any(Function));
  expect(work).toHaveBeenCalledOnce();
});

it("does not start work if cancelled while the immediate use-lock request is being granted", async () => {
  const controller = new AbortController(), work = vi.fn(async () => 17);
  const locks = new ContentLocks({request: async (_name: string, _options: LockOptions, action: (lock: Lock) => Promise<unknown>) => {
    controller.abort("leaving"); return action({name: _name, mode: "exclusive"} as Lock);
  }} as unknown as LockManager);
  await expect(locks.gc("key", work, controller.signal)).rejects.toMatchObject({code: "CONTENT_IO_ABORTED", cause: "leaving"});
  expect(work).not.toHaveBeenCalled();
});
