import {afterEach, vi} from "vitest";
import {createHash} from "node:crypto";
import {contentSessionFixture} from "./content-session-fixture.js";
/** Legacy adapter fixtures supplied body-only Responses. Add real HTTP identity fields here,
 * while leaving protocol tests on their explicit malformed/strict response fixtures. */
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close()));});
export function managedAdapterFixture(config: unknown) {
  const origin = location.origin, origins = new Set([origin]);
  function collect(value: unknown) {
    if (typeof value === "string" && /^https?:\/\//u.test(value)) {origins.add(new URL(value).origin);}
    else if (value && typeof value === "object") {for (const part of Object.values(value)) {collect(part);}}
  }
  collect(config);
  const original = fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const response = await original(input, options);
    const headers = new Headers(response.headers);
    if (!headers.has("ETag")) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      headers.set("ETag", `"sha256-${createHash("sha256").update(bytes).digest("hex")}"`);
    }
    const result = new Response(response.body, {status: response.status, statusText: response.statusText, headers});
    Object.defineProperty(result, "url", {value: new URL(String(input), location.href).href}); return result;
  });
  const owner = contentSessionFixture(origin, [...origins]); owners.push(owner);
  return {contentSession: owner.session, assetIndex: {}};
}
