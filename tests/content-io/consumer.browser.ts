import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
import {contractSha256} from "../../src/content-io/identity.js";
test("[BR-11] BROWSER/consumer [X-06] BROWSER/future-ack rejects unauthorized commands and forged ACK @S05", async ({page}) => {
  const worker = (await build({entryPoints: [fileURLToPath(new URL("../../src/content-io/worker.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
  const server = await startFixtureServer({modules: {"worker.mjs": worker}});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({hash}) => {
      const sessionId = crypto.randomUUID(), channelId = crypto.randomUUID(), {port1, port2} = new MessageChannel();
      const worker = new Worker("/__test__/worker.mjs", {type: "module"});
      const next = (port: MessagePort) => new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("test reply timeout")), 6000);
        port.onmessage = ({data}) => {clearTimeout(timer); resolve(data as Record<string, unknown>);}; port.start();
      });
      let message = next(port1);
      worker.postMessage({type: "BOOT", v: 1, abi: "content-io-v1", contractSha256: hash, sessionId, managementChannelId: channelId,
        managementPort: port2, storageOrigin: location.origin, allowedOrigins: [location.origin], fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}, l1BudgetBytes: 0, l2BudgetBytes: 16777216}, [port2]);
      const ready = await message;
      const base = {v: 1, sessionId, channelId, epoch: 1};
      try {
        message = next(port1);
        port1.postMessage({...base, requestId: 1, type: "OPEN", source: {identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 262144,
          url: `${location.origin}/never-fetch`, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
        policy: {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 999999, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", }});
        const opened = await message;
        const failures = [];
        for (let index = 0; index < 2; index++) {
          const channel = new MessageChannel(), id = crypto.randomUUID(); message = next(port1);
          port1.postMessage({...base, requestId: index + 2, type: "NEW_CHANNEL", consumerChannelId: id, allowedFileIds: [opened.fileId], mode: "ASYNC", port: channel.port2, buffer: null}, [channel.port2]);
          await message;
          const response = next(channel.port1);
          channel.port1.postMessage({...base, channelId: id, requestId: index === 0 ? 1 : 0,
            ...(index === 0 ? {type: "CLOSE_SESSION"} : {type: "READ_ACK", ackRequestId: 777})});
          failures.push(await response); channel.port1.close();
        }
        return {ready, failures};
      } finally {port1.close(); worker.terminate();}
    }, {hash: contractSha256});
    expect(result.ready.backend).toBe("MEMORY");
    expect(result.failures.map((reply) => [reply.type, reply.codeNumber])).toEqual([["CHANNEL_CLOSED", 1], ["CHANNEL_CLOSED", 4]]);
  } finally {await server.close();}
});
