# retrom-runtime

A shared runtime for emulators and game engines in the browser.

retrom-runtime is an open-source TypeScript project for developers building web applications that play retro games. It brings EmulatorJS and independent Web/Wasm engines behind one player interface, so an application can support multiple systems through the same integration.

Your application provides the interface, game library, authorization and persistent storage. retrom-runtime handles game configuration, engine selection, content loading and the player lifecycle.

[Supported platforms and cores](docs/supported-platforms-and-cores.md) · [Documentation](docs/README.md) · [Releases](https://github.com/retrom-project/retrom-runtime/releases)

## What it provides

- **A shared player interface** for starting and stopping games, input, pause, screenshots and audio, with explicit capabilities for each runtime.
- **A platform and core catalog** that connects supported systems and game formats to their runtime implementations.
- **Save and restore contracts** for both instant checkpoints and game-native saves, including content identity and format validation.
- **Managed content loading** with bounded reads, loading progress and persistent browser caching.
- **An offline host tool** for game configuration, dependency discovery and launch preparation.
- **Versioned release bundles** with pinned core assets, integrity metadata and matching host tools.

The [support catalog](docs/supported-platforms-and-cores.md) lists every platform, core, Target and save type. Individual [Target guides](docs/README.md#target-guides) describe supported content, controls and browser requirements.

## How it fits into an application

| Component | Role |
| --- | --- |
| Browser Provider | Runs the selected engine and exposes the shared player interface. |
| Offline host tool | Interprets game files and prepares configuration, dependencies and launch resources. |
| Host application | Supplies the UI, authorized content access and durable save storage. |

The browser and host tool consume the same runtime declarations. Engine-specific rules stay in the runtime, while the application integrates the public interfaces.

## Getting started

1. Choose a version from [GitHub Releases](https://github.com/retrom-project/retrom-runtime/releases). Use the Provider bundles and offline host tool from that same release; `runtime-inputs.json` describes the matching artifacts and their checksums.
2. Follow the [runtime configuration guide](docs/runtime-module.md) to inspect the catalog and prepare a game's launch configuration and resources.
3. Follow the [Provider integration guide](docs/provider-module-v1.md) to create a browser runtime, mount it, handle player events and connect save storage.

The offline host tool requires Node.js 24. Browser features and firmware requirements depend on the selected Target. Release artifacts are distributed through GitHub; this repository is not published to npm.

## Documentation

| Guide | Contents |
| --- | --- |
| [Supported platforms and cores](docs/supported-platforms-and-cores.md) | Complete catalog, core mappings and save types |
| [Runtime configuration](docs/runtime-module.md) | Content interpretation, dependencies, identities and the offline host tool |
| [Provider integration](docs/provider-module-v1.md) | Browser API, lifecycle, capabilities and host interfaces |
| [Content I/O](docs/content-io.md) | Resource loading, caching and content bridges |
| [Development and releases](docs/development.md) | Local setup, checks and release artifacts |

See the [documentation index](docs/README.md) for Target-specific guides and core maintenance.

## Development

Use Node.js 24 and the npm version recorded in [package.json](package.json).

```bash
npm ci
npm run ci:checks
npx playwright install --with-deps chromium
npm run test:content-io:ci
npm run package:check
```

`npm test` builds the runtime before running tests. See [Development and releases](docs/development.md) for Provider packaging and release checks.

## Contributing

Bug reports, integration feedback and pull requests are welcome through [Issues](https://github.com/retrom-project/retrom-runtime/issues) and [Pull requests](https://github.com/retrom-project/retrom-runtime/pulls). For a new runtime integration, start with [Adding a core](docs/adding-a-core.md) and [Maintaining upstream forks](docs/maintaining-forks.md).

## License

retrom-runtime is licensed under the [MIT License](LICENSE). Third-party runtimes retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md) and the notices shipped with each release.
