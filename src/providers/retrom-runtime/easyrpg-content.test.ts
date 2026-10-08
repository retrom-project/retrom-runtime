import {afterEach, expect, it, vi} from "vitest";
import {mountWithEasyRpgContent} from "./easyrpg-content.js";
import {installContentXHR} from "../../easyrpg/content-xhr.js";
import {resourceSources} from "../../provider/preload-sources.js";
import {adapterFixture} from "../../../tests/provider-adapter-fixture.js";
import {targetEnvelope} from "../../../tests/provider-fixtures.js";
import {eagerPolicy} from "../../provider/content-policies.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
vi.mock("../../easyrpg/content-xhr.js", () => ({installContentXHR: vi.fn(() => vi.fn())}));
vi.mock("../../provider/preload-sources.js", () => ({resourceSources: vi.fn()}));
afterEach(() => {vi.clearAllMocks();});
const source = {identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "CharSet/Hero.PNG"},
  url: new URL("/api/v1/runs/run/resources/blob/Hero.PNG", location.href).href, sizeBytes: 3, purpose: "GAME",
  transport: "WHOLE_ALLOWED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
it("adapts the canonical UUID index and exact payload URLs to the pinned native engine index", async () => {
  const envelope = targetEnvelope("rpgmaker-2000");
  envelope.resources = [{kind: "FILE_TREE", role: "game", ordinal: 0, contentDigest: "a".repeat(64),
    indexUrl: "/api/v1/runs/run/resources/index/id"}];
  vi.mocked(resourceSources).mockResolvedValue([source]);
  const policy = eagerPolicy(100, {mode: "ON_OPEN"}), cleanup = vi.fn();
  vi.mocked(installContentXHR).mockReturnValue(cleanup);
  const session = {inputPolicy: () => policy} as unknown as AdapterContentSession;
  const adapter = await mountWithEasyRpgContent(envelope, window, session, new AbortController().signal, async () => adapterFixture());
  const files = vi.mocked(installContentXHR).mock.calls[0][1];
  const root = new URL("/api/v1/runs/run/resources/index/id/", location.href).href;
  const metadata = files.get(root + "index.json")!;
  expect("metadata" in metadata && JSON.parse(new TextDecoder().decode(metadata.metadata))).toEqual({
    metadata: {version: 2}, cache: {charset: {_dirname: "CharSet", hero: "Hero.PNG"}}});
  expect(files.get(root + "CharSet/Hero.PNG")).toEqual({source, policy});
  expect(files.get(source.url)).toEqual({source, policy});
  await adapter.exit(); expect(cleanup).toHaveBeenCalledOnce();
});
it("rejects ambiguous case-folded game files before starting the core", async () => {
  vi.mocked(resourceSources).mockResolvedValue([source, {...source, identity: {...source.identity, logicalPath: "charset/hero.png"}}]);
  const mount = vi.fn(async () => adapterFixture());
  await expect(mountWithEasyRpgContent(targetEnvelope("rpgmaker-2000"), window,
    {inputPolicy: () => eagerPolicy(100, {mode: "ON_OPEN"})} as unknown as AdapterContentSession,
    new AbortController().signal, mount)).rejects.toThrow("RPG_RUNTIME_PACK_INVALID");
  expect(mount).not.toHaveBeenCalled();
});


it("rejects extension-stripped image lookup collisions before starting the core", async () => {
  vi.mocked(resourceSources).mockResolvedValue([source, {...source, identity: {...source.identity, logicalPath: "CharSet/Hero.xyz"}}]);
  const envelope = targetEnvelope("rpgmaker-2000");
  envelope.resources = [{kind: "FILE_TREE", role: "game", ordinal: 0, contentDigest: "a".repeat(64), indexUrl: "/index"}];
  const mount = vi.fn(async () => adapterFixture());
  await expect(mountWithEasyRpgContent(envelope, window,
    {inputPolicy: () => eagerPolicy(100, {mode: "ON_OPEN"})} as unknown as AdapterContentSession,
    new AbortController().signal, mount)).rejects.toThrow("RPG_RUNTIME_PACK_INVALID");
  expect(mount).not.toHaveBeenCalled();
});
