import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build, transform} from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Compile the selected execution branch, without release labels or other Target declarations. */
export async function fingerprintProvider(definition, assetIndex, sourceOverrides = {}) {
  const result = {};
  for (const target of definition.targets) {
    const adapter = definition.adapters.find(item => item.id === target.adapterId);
    if (!adapter) {throw new Error("RUNTIME_IMPLEMENTATION_INVALID");}
    const code = await selectedImplementation(definition, target, adapter, sourceOverrides);
    const inputs = [{kind: "ADAPTER", path: "selected-client.mjs", sha256: sha256(code)}];
    for (const path of executionAssets(target)) {
      const identity = assetIndex[path];
      if (!identity || !/^[a-f0-9]{64}$/u.test(identity.sha256)) {throw new Error(`RUNTIME_IMPLEMENTATION_ASSET_MISSING:${path}`);}
      inputs.push({kind: "ASSET", path, sha256: identity.sha256});
    }
    inputs.sort((a, b) => Buffer.from(`${a.kind}:${a.path}`).compare(Buffer.from(`${b.kind}:${b.path}`)));
    result[target.id] = {fingerprint: sha256(canonicalBytes({targetId: target.id, inputs})), inputs};
  }
  return result;
}

export function executionAssets(target) {
  return target.assetPaths.filter(path => !path.includes("/reports/") && !path.endsWith("cores.json") &&
    !path.includes("/localization/") && !path.endsWith(".css") && !path.endsWith("-arcade.dat") &&
    !path.endsWith("-content-pair.json") && !path.endsWith("-rom-requirements.json") &&
    (!path.endsWith("ppsspp-assets.zip") || target.implementation.runtimeCore === "ppsspp" || target.id === "ppsspp"));
}

async function selectedImplementation(provider, target, adapter, sourceOverrides) {
  const providerId = provider.providerId;
  const definitionName = providerId === "emulatorjs" ? "emulatorJsProviderDefinition" : "retromRuntimeProviderDefinition";
  const identityTarget = {...target, displayName: "", implementation: runtimeImplementation(target.implementation)};
  const definition = {providerId, providerVersion: "0.0.0-dev", providerApiVersion: 1,
    targets: [identityTarget], adapters: [adapter]};
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "src/providers", providerId, "module.ts")],
    bundle: true, format: "esm", write: false, minifySyntax: true, minifyIdentifiers: false, legalComments: "none",
    platform: "browser", target: "es2022", treeShaking: true,
    define: {__RETROM_PROVIDER_VERSION__: '"0.0.0-dev"', __RETROM_PROVIDER_ASSET_INDEX__: "{}",
      __RETROM_PFB_CORE_INPUTS__: "{}", process: "{}", "process.cwd": "String", "process.platform": '"browser"'},
    plugins: [{name: "selected-runtime", setup(builder) {
      builder.onLoad({filter: new RegExp("providers[/\\\\](?:retrom-runtime|emulatorjs)[/\\\\]catalog\\.ts$")}, () => ({
        contents: `export const ${definitionName} = ${JSON.stringify(definition)};`, loader: "ts",
      }));
      builder.onLoad({filter: new RegExp("(?:provider-runtime|target-adapter)\\.ts$")}, async args => {
        let contents = sourceOverrides[args.path] ?? await readFile(args.path, "utf8");
        if (args.path.endsWith("target-adapter.ts")) {
          const dispatch = "const {declaration, adapter} = resolveAdapter(envelope.runtime.targetId);";
          if (contents.split(dispatch).length !== 2 || !contents.includes("switch (adapter.kind)") || !contents.includes("switch (kind)")) {throw new Error("RUNTIME_FINGERPRINT_DISPATCH_INVALID");}
          contents = contents.replace(dispatch,
            `const declaration = ${JSON.stringify(identityTarget)}; const adapter = ${JSON.stringify(adapter)};`)
            .replaceAll("switch (adapter.kind)", `switch (${JSON.stringify(adapter.kind)})`)
            .replaceAll("switch (kind)", `switch (${JSON.stringify(adapter.kind)})`);
        } else {
          const core = target.implementation.runtimeCore;
          if (core && !contents.includes("this.implementation.runtimeCore")) {throw new Error("RUNTIME_FINGERPRINT_DISPATCH_INVALID");}
          if (core) {contents = contents.replaceAll("this.implementation.runtimeCore", JSON.stringify(core));}
        }
        return {contents, loader: "ts", resolveDir: dirname(args.path)};
      });
      builder.onLoad({filter: new RegExp("\\.ts$")}, args => sourceOverrides[args.path] === undefined ? undefined :
        {contents: sourceOverrides[args.path], loader: "ts", resolveDir: dirname(args.path)});
    }}],
  });
  if (result.outputFiles.length !== 1) {throw new Error("RUNTIME_IMPLEMENTATION_INVALID");}
  // Allocate minified names only after unrelated modules have been removed.
  // One-pass bundle/minify lets dead modules change the selected code's names.
  const canonical = await transform(result.outputFiles[0].contents, {format: "esm", minify: true,
    legalComments: "none", target: "es2022"});
  return Buffer.from(canonical.code);
}

function runtimeImplementation(implementation) {
  const actual = {...implementation};
  delete actual.coreBundleVersion;
  delete actual.artifactSetSha256;
  return actual;
}

function canonicalBytes(value) {
  if (Array.isArray(value)) {return Buffer.from(JSON.stringify(value));}
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))));
}
function sha256(bytes) {return createHash("sha256").update(bytes).digest("hex");}
