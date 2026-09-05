import {describe, expect, it} from "vitest";
import {createRuntime} from "../src/index.js";
import {projectProviderManifest} from "../src/provider/manifest.js";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import {hostFixture} from "./provider-adapter-fixture.js";
import {targetEnvelope} from "./provider-fixtures.js";

describe("current Provider launch boundary", () => {
  it.each(retromRuntimeProviderDefinition.targets.map((target) => target.id))(
    "accepts %s with only its declared inputs", async (id) => {
      const player = await createRuntime(targetEnvelope(id), hostFixture());
      expect(player.getState()).toBe("CREATED");
      expect(player.getCapabilities().checkpoint).toBe(true);
      expect(player.getCapabilities().standardGamepad).toBe(true);
      await player.exit();
    },
  );

  it.each([
    {entryUrl: "https://other.example/runtime/entry"},
    {origin: "https://user@runtime.example"},
    {bootstrapTicket: ""},
    {cleanupUrl: "data:text/plain,cleanup"},
    {cleanupUrl: "https://other.example/cleanup"},
  ])("rejects unsafe isolated Web resource %j", async (change) => {
    const request = targetEnvelope("tyranoscript");
    Object.assign(request.resources[0], change);
    await expect(createRuntime(request, hostFixture())).rejects.toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });

  it.each([{sizeBytes: 65537}, {sizeBytes: 0}, {url: "javascript:alert(1)"}])(
    "rejects invalid WASM-4 cart metadata %j before core creation", async (change) => {
      const request = targetEnvelope("wasm4");
      Object.assign(request.resources[0], change);
      await expect(createRuntime(request, hostFixture())).rejects.toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    },
  );

  it("rejects a mutable project identity before any Butterscotch cache is opened", async () => {
    const request = targetEnvelope("butterscotch-gamemaker");
    Object.assign(request.resources[0], {contentDigest: "mutable-project"});
    await expect(createRuntime(request, hostFixture())).rejects.toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });

  it("does not accept a second conflicting engine or adapter selector", async () => {
    for (const fields of [{generation: "RPG2003"}, {engineMode: "rpg2k3"}, {adapterId: "native-web"}]) {
      const request = targetEnvelope("rpgmaker-2000");
      Object.assign(request.targetOptions, fields);
      await expect(createRuntime(request, hostFixture())).rejects.toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
    }
  });

  it("uses one declaration for all seven RPG targets and non-RPG core capabilities", () => {
    const targets = projectProviderManifest(retromRuntimeProviderDefinition).targets;
    expect(targets.filter((entry) => entry.id.startsWith("rpgmaker-")).map((entry) => entry.id)).toEqual([
      "rpgmaker-2000", "rpgmaker-2003", "rpgmaker-mv", "rpgmaker-mz", "rpgmaker-vx", "rpgmaker-vx-ace", "rpgmaker-xp",
    ]);
    expect(retromRuntimeProviderDefinition.adapters.map((entry) => entry.kind).sort()).toEqual([
      "BUTTERSCOTCH_WEB", "EASYRPG_WEB", "KIRIKIRI2_WEB", "MKXP_LIBRETRO_WEB", "NATIVE_WEB", "ONS_YURI_WEB",
      "TYRANOSCRIPT_WEB", "WASM4_WEB",
    ]);
    for (const entry of targets) {
      expect(entry.capabilities.standardGamepad).toBe(true);
      expect(entry.capabilities.checkpoint).toBe(true);
      expect(entry.inputs.length).toBeGreaterThan(0);
      expect(entry.checkpoint?.writeFormat).toMatch(/^[a-z0-9][a-z0-9.-]{0,63}$/u);
    }
  });
});
