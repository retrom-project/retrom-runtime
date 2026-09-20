// Injected into released clients from their tag-derived manifest; PFB uses its verified base.
declare const __RETROM_PROVIDER_VERSION__: string | undefined;
export const providerVersion = typeof __RETROM_PROVIDER_VERSION__ === "undefined" ? "0.0.0-dev" : __RETROM_PROVIDER_VERSION__;
