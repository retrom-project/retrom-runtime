/** Run desktop Tyrano storage calls through the engine's browser storage implementation. */
export function installTyranoBrowserStorage(global) {
    const releases = [];
    const installed = new WeakSet();
    function install(library) {
        if (!library || (typeof library !== "object" && typeof library !== "function") || installed.has(library)) return;
        installed.add(library);
        for (const [desktop, browser] of [["getStorageFile", "getStorageWeb"], ["setStorageFile", "setStorageWeb"]]) {
            const descriptor = Object.getOwnPropertyDescriptor(library, desktop);
            if (descriptor && !descriptor.configurable) continue;
            let original = library[desktop];
            const redirect = function () {
                if (typeof library[browser] !== "function") throw new Error("TYRANOSCRIPT_BROWSER_STORAGE_UNAVAILABLE");
                return library[browser].apply(library, arguments);
            };
            const get = () => redirect;
            Object.defineProperty(library, desktop, {configurable: true, enumerable: true,
                get, set: value => {original = value;}});
            releases.push(() => {
                if (Object.getOwnPropertyDescriptor(library, desktop)?.get !== get) return;
                Object.defineProperty(library, desktop, {configurable: true, enumerable: descriptor?.enumerable ?? true,
                    writable: true, value: original});
            });
        }
    }
    for (const name of ["$", "jQuery"]) {
        const descriptor = Object.getOwnPropertyDescriptor(global, name);
        let library = global[name];
        install(library);
        if (descriptor && !descriptor.configurable) continue;
        const get = () => library;
        Object.defineProperty(global, name, {configurable: true, enumerable: descriptor?.enumerable ?? true,
            get, set: value => {library = value; install(value);}});
        releases.push(() => {
            if (Object.getOwnPropertyDescriptor(global, name)?.get !== get) return;
            Object.defineProperty(global, name, {configurable: true, enumerable: descriptor?.enumerable ?? true,
                writable: true, value: library});
        });
    }
    return () => {for (const release of releases.reverse()) release(); releases.length = 0;};
}
