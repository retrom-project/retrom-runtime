import {beforeEach, describe, expect, it, vi} from "vitest";
import {mountEasyRpg} from "../../easyrpg/adapter.js";
import {mountMkxp} from "../../mkxp/adapter.js";
import {mountNativeRpg} from "../../native-web/adapter.js";
import {mountOnsYuri} from "../../ons/adapter.js";
import {mountKirikiri2} from "../../kirikiri/adapter.js";
import {mountButterscotch} from "../../butterscotch/adapter.js";
import {mountTyranoScript} from "../../tyranoscript/adapter.js";
import {mountWasm4} from "../../wasm4/adapter.js";
import {targetEnvelope} from "../../../tests/provider-fixtures.js";
import {mountTargetAdapter, type TargetMountContext} from "./target-adapter.js";

vi.mock("../../easyrpg/adapter.js", () => ({mountEasyRpg: vi.fn()}));
vi.mock("../../mkxp/adapter.js", () => ({mountMkxp: vi.fn()}));
vi.mock("../../native-web/adapter.js", () => ({mountNativeRpg: vi.fn()}));
vi.mock("../../ons/adapter.js", () => ({mountOnsYuri: vi.fn()}));
vi.mock("../../kirikiri/adapter.js", () => ({mountKirikiri2: vi.fn()}));
vi.mock("../../butterscotch/adapter.js", () => ({mountButterscotch: vi.fn()}));
vi.mock("../../tyranoscript/adapter.js", () => ({mountTyranoScript: vi.fn()}));
vi.mock("../../wasm4/adapter.js", () => ({mountWasm4: vi.fn()}));
beforeEach(() => {vi.clearAllMocks();});

const assetIndex = {
  "assets/mkxp/mkxp-z_libretro.js": {sha256: "c".repeat(64), sizeBytes: 1000},
  "assets/mkxp/mkxp-z_libretro.wasm": {sha256: "d".repeat(64), sizeBytes: 2000},
};

function context(): TargetMountContext {
  return {
    assetIndex, frame: document.createElement("iframe"), frameWindow: window,
    restorePayload: null, reportProgress: vi.fn(), reportExitRequested: vi.fn(), onDiagnostic: vi.fn(),
  };
}

describe("Provider to core-private parameters", () => {
  it.each([["rpgmaker-2000", "rpg2k"], ["rpgmaker-2003", "rpg2k3"]])(
    "constructs only the EasyRPG parameters for %s", async (id, engineMode) => {
      const request = targetEnvelope(id);
      const target = document.createElement("div");
      const options = context();
      await mountTargetAdapter(request, target, options);
      expect(mountEasyRpg).toHaveBeenCalledWith({
        sessionId: request.session.id, engineMode, checkpointSlot: 100,
        projectRootUrl: `/runtime/content/project/${"a".repeat(64)}/`, rtpSource: null,
        runtimeBaseUrl: request.runtime.runtimeBaseUrl + "assets/easyrpg/",
      }, target, window, null, options.reportExitRequested);
      expect(JSON.stringify(request)).not.toMatch(/adapter|engineMode|generation|validationPurpose/u);
    },
  );

  it.each([["rpgmaker-xp", 1], ["rpgmaker-vx", 2], ["rpgmaker-vx-ace", 3]] as const)(
    "constructs verified mkxp assets and exact RGSS parameters for %s", async (id, rgssVersion) => {
      const request = targetEnvelope(id);
      await mountTargetAdapter(request, document.createElement("div"), context());
      expect(vi.mocked(mountMkxp).mock.calls[0][0]).toEqual({
        core: {
          jsSha256: "c".repeat(64), jsSizeBytes: 1000,
          jsUrl: request.runtime.runtimeBaseUrl + "assets/mkxp/mkxp-z_libretro.js",
          wasmSha256: "d".repeat(64), wasmSizeBytes: 2000,
          wasmUrl: request.runtime.runtimeBaseUrl + "assets/mkxp/mkxp-z_libretro.wasm",
        },
        expectedRestorePosition: null,
        projectArchive: {
          kind: "SEEKABLE_BLOB", rangeRequired: true, sha256: "a".repeat(64), sizeBytes: 4096,
          url: `/runtime/content/project/${"a".repeat(64)}/game.mkxpz`,
        },
        rgssVersion, rtpArchives: [], runtimeBaseUrl: request.runtime.runtimeBaseUrl + "assets/mkxp/",
        stateBufferBytes: 268435456,
      });
    },
  );

  it.each([["rpgmaker-mv", "RPGMV"], ["rpgmaker-mz", "RPGMZ"]])(
    "passes an isolated RPG bridge %s only its own parameters", async (id, bridgeProfile) => {
      const request = targetEnvelope(id);
      const options = context();
      await mountTargetAdapter(request, document.createElement("div"), options);
      expect(mountNativeRpg).toHaveBeenCalledWith({
        sessionId: request.session.id, bridgeProfile, bootstrapTicket: "t".repeat(48),
        bootstrapUrl: "https://runtime.test/__retrom/bootstrap", cleanupUrl: "https://runtime.test/__retrom/cleanup",
        uniqueOrigin: "https://runtime.test",
      }, options.frame, null, options.reportExitRequested);
    },
  );

  it("preserves ONS encoding and KiriKiri XP3 selection without RPG fields", async () => {
    const ons = targetEnvelope("onscripter-yuri");
    ons.targetOptions.scriptEncoding = "sjis";
    await mountTargetAdapter(ons, document.createElement("div"), context());
    expect(vi.mocked(mountOnsYuri).mock.calls[0][0]).toEqual({
      checkpointSlot: 999, scriptEncoding: "sjis", projectIndexUrl: `/runtime/content/project/${"a".repeat(64)}/index.json`,
      runtimeBaseUrl: ons.runtime.runtimeBaseUrl + "assets/ons/",
    });
    const kiri = targetEnvelope("kirikiri2-kag");
    kiri.targetOptions.startupXp3Path = "data.xp3";
    await mountTargetAdapter(kiri, document.createElement("div"), context());
    expect(vi.mocked(mountKirikiri2).mock.calls[0][0]).toEqual({
      checkpointSlot: 1999, startupXp3Path: "data.xp3", projectIndexUrl: `/runtime/content/project/${"a".repeat(64)}/index.json`,
      runtimeBaseUrl: kiri.runtime.runtimeBaseUrl + "assets/kirikiri/",
    });
  });

  it("preserves Butterscotch project identity and session-local saves", async () => {
    const request = targetEnvelope("butterscotch-gamemaker");
    await mountTargetAdapter(request, document.createElement("div"), context());
    expect(vi.mocked(mountButterscotch).mock.calls[0][0]).toEqual({
      sessionId: request.session.id, contentDigest: "a".repeat(64),
      projectIndexUrl: `/runtime/content/project/${"a".repeat(64)}/index.json`,
      runtimeBaseUrl: request.runtime.runtimeBaseUrl + "assets/butterscotch/",
    });
  });

  it("preserves isolated Web tickets without a duplicate project identity", async () => {
    const request = targetEnvelope("tyranoscript");
    const options = context();
    await mountTargetAdapter(request, document.createElement("div"), options);
    expect(mountTyranoScript).toHaveBeenCalledWith({
      sessionId: request.session.id, bootstrapTicket: "t".repeat(48), uniqueOrigin: "https://runtime.test",
      cleanupUrl: "https://runtime.test/__retrom/cleanup", entryUrl: "https://runtime.test/__retrom/bootstrap",
    }, options.frame, null, options.reportExitRequested);
  });

  it("constructs WASM-4 cart data without a fake session or adapter identity", async () => {
    const request = targetEnvelope("wasm4");
    const target = document.createElement("div");
    const options = context();
    await mountTargetAdapter(request, target, options);
    expect(mountWasm4).toHaveBeenCalledWith({
      contentDigest: "a".repeat(64), cartSizeBytes: 128, cartUrl: "/runtime/content/game/cart.wasm",
      runtimeBaseUrl: request.runtime.runtimeBaseUrl + "assets/wasm4/",
    }, target, window, null, options.reportProgress);
  });

  it("does not initialize a threaded core without its verified asset inventory", () => {
    expect(() => mountTargetAdapter(targetEnvelope("rpgmaker-xp"), document.createElement("div"), {
      ...context(), assetIndex: {},
    })).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    expect(mountMkxp).not.toHaveBeenCalled();
  });
});
