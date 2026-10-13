import {afterEach, expect, it, vi} from "vitest";
import {ProviderContentOwner} from "./content-owner.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import type {LaunchEnvelopeV1} from "./module-api.js";
import {bootstrapContentSession} from "../content-io/bootstrap.js";

vi.mock("../content-io/bootstrap.js", () => ({bootstrapContentSession: vi.fn(async () => ({close: vi.fn(async () => {})}))}));
afterEach(() => vi.clearAllMocks());

it("owns a core asset cache even when the upstream loader owns game content", async () => {
  const target = retromRuntimeProviderDefinition.targets.find(target => target.id === "j2me")!;
  const envelope = {runtime: {runtimeBaseUrl: "/provider/"}, resources: [{role: "game", kind: "ROM_BLOB", url: "/game.jar"}]} as LaunchEnvelopeV1;
  const owner = new ProviderContentOwner(() => {});
  const session = await owner.start(target, envelope, {});
  expect(session).not.toBeNull();
  expect(bootstrapContentSession).toHaveBeenCalledOnce();
  await owner.close();
  expect(session!.close).toHaveBeenCalledOnce();
});
