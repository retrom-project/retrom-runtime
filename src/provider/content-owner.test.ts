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

it("[NET-09] forwards content network waits to its owner until it stops", async () => {
  const target = retromRuntimeProviderDefinition.targets.find(target => target.id === "j2me")!;
  const envelope = {runtime: {runtimeBaseUrl: "/provider/"}, resources: [{role: "game", kind: "ROM_BLOB", url: "/game.jar"}]} as LaunchEnvelopeV1;
  const network = vi.fn();
  const owner = new ProviderContentOwner(() => {}, () => {}, network);
  await owner.start(target, envelope, {});
  const options = vi.mocked(bootstrapContentSession).mock.calls[0][0];
  options.onNetwork?.("WAITING"); options.onNetwork?.("RESTORED");
  expect(network.mock.calls).toEqual([["WAITING"], ["RESTORED"]]);
  await owner.close(); options.onNetwork?.("WAITING");
  expect(network).toHaveBeenCalledTimes(2);
});
