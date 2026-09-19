# retrom-runtime

Host-independent browser library and release bundle for retro game runtimes. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Supported Targets

The runtime currently includes the following targets across two Providers (`retrom-runtime` and `emulatorjs`):

- **RPG Maker** — EasyRPG (2000/2003), mkxp (XP/VX/VX Ace), native Web (MV/MZ)
- **ONScripterYuri** — ONS visual novel games
- **KiriKiri2** — KAG-based visual novel games
- **Butterscotch** — GameMaker projects
- **TyranoScript** — browser TyranoScript projects
- **WASM-4** — fantasy console carts
- **Java ME** — J2ME JAR MIDlets
- **ScummVM** — point-and-click adventure games (105 engine plugins)
- **EmulatorJS cores** — SNES (bsnes/Snes9x), Mega Drive, PSP (PPSSPP), PS2 (Play!), Dreamcast (Flycast), PC-98 (NP2kai), MSX (WebMSX), Pokémon Mini (GBE+), Uzebox, Intellivision, Vectrex, PC-88 (QUASI88), NeoCD, Flash (Ruffle), OpenBOR, PX68K, TIC-80, FAKE-08, Cave Story (NXEngine), and various home computers (Fuse, Gearcoleco, PrBoom, PUAE, VICE, Virtual Jaguar, CrocoDS, Caprice32, EightyOne, CD-i, PET, Plus/4, C64)

For detailed documentation on individual targets, see the [docs](docs/) directory.

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
