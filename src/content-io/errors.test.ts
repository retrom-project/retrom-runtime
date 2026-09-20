import {expect, it} from "vitest";
import {ContentIOError, errorNumbers, toContentIOError} from "./errors.js";
it("freezes the stable error number table and sanitizes unexpected failures", () => {
  expect(Object.values(errorNumbers)).toEqual(Array.from({length: 17}, (_, index) => index + 1));
  const error = new ContentIOError("IDENTITY_CHANGED");
  expect(error.codeNumber).toBe(5); expect(error.scope).toBe("OBJECT"); expect(error.retryable).toBe(false);
  expect(toContentIOError(error)).toBe(error);
  expect(toContentIOError(new Error("private URL"))).toMatchObject({code: "CONTENT_IO_INTERNAL", codeNumber: 17});
});
