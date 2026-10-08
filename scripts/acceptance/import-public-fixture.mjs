import {readFile, writeFile} from "node:fs/promises";
import {acceptanceArgs, openAcceptanceBrowser} from "./product-browser.mjs";

const args = acceptanceArgs(["inputs", "relative-path"]);
const inputs = JSON.parse(await readFile(args.inputs, "utf8")), browser = await openAcceptanceBrowser(args);
try {
  const context = await browser.newContext({storageState: args["storage-state"]});
  const page = await context.newPage(); await page.goto(`${args.base}/library`);
  const result = await page.evaluate(async ({inputs, relativePath}) => {
    const auth = await (await fetch("/api/v1/auth/context")).json();
    const call = async (path, data) => {
      const response = await fetch(`/api/v1${path}`, {method: data ? "POST" : "GET",
        headers: {"Content-Type": "application/json", "X-Retrom-Csrf": auth.csrfToken}, body: data ? JSON.stringify(data) : undefined});
      const value = await response.json();
      if (response.status !== 200) {throw new Error(`${path}:${response.status}:${JSON.stringify(value)}`);}
      return value;
    };
    const existing = (await call("/admin/platform-instances")).items, prepared = [];
    for (const input of inputs) {
      const slug = `runtime-${input.slug}`;
      const directory = existing.find(item => item.slug === slug) ?? await call("/admin/platform-instances", {
        platformId: input.platformId, name: input.title, slug, description: "Runtime product acceptance",
        defaultCoreId: input.coreId, coreIds: [input.coreId], enabled: true,
      });
      prepared.push({...input, directoryId: directory.id});
    }
    const source = {rootId: "acceptance", relativePath, format: "pegasus"};
    const inspection = await call("/admin/game-scans/inspect", source);
    const mappings = inspection.items.flatMap(collection => {
      const row = prepared.find(row => row.slug === collection.name);
      return row ? [{sourceKey: collection.key, platformInstanceId: row.directoryId, tagIds: []}] : [];
    });
    return {prepared, scan: await call("/admin/game-scans", {...source, mappings}), collections: mappings.length};
  }, {inputs, relativePath: args["relative-path"]});
  await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({directories: result.prepared.length, scanId: result.scan.id, collections: result.collections})}\n`);
} finally {await browser.close();}
