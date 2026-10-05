import {describe, expect, it} from "vitest";
import {ContentIOError} from "../content-io/errors.js";
import {createRuntimeFailure, RuntimeFailureError} from "./failure.js";

describe("persistent runtime failure", () => {
  it("retains native diagnostics and cause before cleanup without exposing private paths or URLs", () => {
    const cause = new Error("unreachable at https://private.example/core.wasm?token=secret /home/user/game/private.pak");
    const error = new RuntimeFailureError("OPENBOR_CORE_EXITED", "CONTENT", ["Unknown constant V_TRANSPLENT in data/scripts/game.c", "Authorization: Bearer secret"], {cause});
    const failure = createRuntimeFailure(error.message, error, "STARTUP");
    expect(failure).toMatchObject({category: "CONTENT", phase: "STARTUP", retryable: false});
    expect(failure.diagnostics.some(item => item.message.includes("V_TRANSPLENT"))).toBe(true);
    expect(JSON.stringify(failure)).not.toMatch(/private\.example|private\.pak|secret|\/home\//u);
  });
  it("retries transient transport failures only and retains the runtime phase", () => {
    expect(createRuntimeFailure("CONTENT_IO_NETWORK_FAILED", undefined, "PLAYING")).toMatchObject({category: "NETWORK", retryable: true, phase: "PLAYING"});
    for (const code of ["OPENBOR_CORE_ABORTED", "PLAYER_RUNTIME_CSP_BLOCKED", "PLAYER_CONTENT_REJECTED", "CONTENT_IO_CHECKSUM_MISMATCH"]) {
      expect(createRuntimeFailure(code, undefined, "STARTUP").retryable).toBe(false);
    }
  });
  it.each(["LENGTH_MISMATCH", "CHECKSUM_MISMATCH", "IDENTITY_CHANGED"] as const)(
    "classifies the Content I/O %s error as content evidence without retry", name => {
      const error = new ContentIOError(name);
      expect(createRuntimeFailure(error.code, error, "STARTUP")).toMatchObject({
        code: error.code, category: "CONTENT", phase: "STARTUP", retryable: false,
      });
    },
  );
  it("bounds recursive causes and noisy diagnostics", () => {
    const error = new RuntimeFailureError("OPENBOR_CORE_EXITED", "CONTENT", Array(20).fill("x".repeat(2000)));
    error.cause = error;
    const failure = createRuntimeFailure(error.message, error, "STARTUP");
    expect(failure.diagnostics.length).toBeLessThanOrEqual(8);
    expect(failure.diagnostics.every(item => item.message.length <= 500)).toBe(true);
  });
});
