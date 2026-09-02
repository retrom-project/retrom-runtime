import {mkdir} from "node:fs/promises";
import {dirname, isAbsolute} from "node:path";
import {build} from "esbuild";

export async function buildProviderClient(input) {
  if (!isAbsolute(input.entryPoint) || !isAbsolute(input.outfile) ||
    !input.outfile.endsWith("/client.mjs") && !input.outfile.endsWith("\\client.mjs")) {
    throw new Error("PROVIDER_CLIENT_BUILD_INVALID");
  }
  await mkdir(dirname(input.outfile), {recursive: true});
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    define: {
      __RETROM_PROVIDER_ASSET_INDEX__: JSON.stringify(input.assetIndex),
      __RETROM_PROVIDER_TARGET_DIGESTS__: JSON.stringify(input.targetDigests),
    },
    entryPoints: [input.entryPoint],
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    minify: true,
    outfile: input.outfile,
    platform: "browser",
    sourcemap: false,
    splitting: false,
    target: "es2022",
    treeShaking: true,
  });
  const outputs = Object.values(result.metafile.outputs);
  const externalImports = outputs.flatMap((output) => output.imports)
    .filter((entry) => entry.external)
    .map((entry) => entry.path)
    .sort();
  if (outputs.length !== 1 || externalImports.length !== 0) {
    throw new Error("PROVIDER_CLIENT_BUILD_INVALID");
  }
  return {externalImports, outfile: input.outfile, outputCount: outputs.length};
}
