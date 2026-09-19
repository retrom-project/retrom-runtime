# retrom-runtime

Host-independent browser library and release bundle for retro game runtimes. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Documentation

Supported targets, Provider Module architecture and core integration guides are maintained in the [docs](docs/) directory.

Managed game acquisition and cache/bridge ownership are described in [Content I/O v1](docs/content-io.md).

## Provider Module V1

Hosts integrate the generated Provider Bundle. A Bundle exports one `client.mjs`:

```ts
export const providerId = "retrom-runtime";
export const providerVersion = "0.16.0";
export const providerApiVersion = 1;
export async function createRuntime(
  value: unknown,
  host: RuntimeHostV1,
): Promise<PlayerRuntimeV1>;
```

The host validates a Launch Envelope V1, verifies the module URL and SHA-256 against the active Bundle, imports the module, checks the exported identity and calls `createRuntime`.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
```

Before publishing a release tag, also run:

```bash
npm run provider:input:check
npm run provider:build
npm run provider:check
npm run release:build
```

## License

MIT
