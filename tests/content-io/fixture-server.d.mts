import type {ContentIdentityV1} from "../../contracts/content-io/v1/content-io.js";
export type FixtureScenario = {id: string; fixtureId: string; behavior: string; seed: number;
  delayBeforeHeadersMs: number | null; chunkDelayMs: number | null; disconnectAfterBytes: number | null; barrier: string | null};
export type FixtureIdentity = {sizeBytes: number; etag: string; identity: ContentIdentityV1};
export function fixtureIdentity(id: string, seed?: number): FixtureIdentity;
export function startFixtureServer(options?: {contentModule?: string; modules?: Record<string, string>; staticFiles?: Record<string, Uint8Array>}): Promise<{
  fileRequests: {name: string; method: string; range: string | null}[];
  origin: string; register(scenario: FixtureScenario): FixtureIdentity; release(id: string): void;
  requests(id: string): {method: string; range: string | null; ifMatch: string | null; sentBytes: number; complete: boolean; disconnected: boolean}[];
  close(): Promise<void>;
}>;
