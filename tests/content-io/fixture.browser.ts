import {test, expect} from "@playwright/test";
import {startFixtureServer} from "./fixture-server.mjs";

test("[S01] BROWSER/fixture-secure-context @S01", async ({page}) => {
  const server = await startFixtureServer();
  try {
    await page.goto(`${server.origin}/__test__/page`);
    expect(await page.evaluate(() => ({secure: isSecureContext, isolated: crossOriginIsolated,
      sab: typeof SharedArrayBuffer === "function"}))).toEqual({secure: true, isolated: true, sab: true});
    server.register({id: "browser", behavior: "NORMAL", fixtureId: "one", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    const response = await page.evaluate(async () => {
      const result = await fetch("/objects/one/browser", {headers: {Range: "bytes=0-0"}});
      return {status: result.status, bytes: [...new Uint8Array(await result.arrayBuffer())]};
    });
    expect(response).toEqual({status: 206, bytes: [17]});
    expect(server.requests("browser")).toHaveLength(1);
  } finally {await server.close();}
});
