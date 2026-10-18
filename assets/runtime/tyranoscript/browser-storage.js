/** Use the engine's browser storage implementation, or its legacy escaped JSON format. */
export function installTyranoBrowserStorage(global) {
    const releases = [];
    const installed = new WeakSet();
    const legacyStorage = {
        getStorage(key) {
            if (!global.localStorage) throw new Error("TYRANOSCRIPT_BROWSER_STORAGE_UNAVAILABLE");
            const stored = global.localStorage.getItem(key);
            const value = stored === null ? null : unescape(stored);
            return value === "null" ? null : value;
        },
        setStorage(key, value) {
            if (!global.localStorage) throw new Error("TYRANOSCRIPT_BROWSER_STORAGE_UNAVAILABLE");
            global.localStorage.setItem(key, escape(JSON.stringify(value)));
        }
    };
    function install(library) {
        if (!library || (typeof library !== "object" && typeof library !== "function") || installed.has(library)) return;
        installed.add(library);
        for (const [desktop, browser] of [["getStorageFile", "getStorageWeb"], ["setStorageFile", "setStorageWeb"],
            ["getStorage", "getStorageWeb"], ["setStorage", "setStorageWeb"]]) {
            const descriptor = Object.getOwnPropertyDescriptor(library, desktop);
            if (descriptor && !descriptor.configurable) continue;
            let original = library[desktop];
            const legacy = legacyStorage[desktop];
            const adapt = implementation => function () {
                if (typeof library[browser] === "function") {
                    // Keep modern dispatchers (including compressed storage and plugin wrappers).
                    if (legacy && typeof implementation === "function") return implementation.apply(this, arguments);
                    return library[browser].apply(library, arguments);
                }
                if (legacy) return legacy.apply(library, arguments);
                throw new Error("TYRANOSCRIPT_BROWSER_STORAGE_UNAVAILABLE");
            };
            let redirect = adapt(original);
            const get = () => redirect;
            Object.defineProperty(library, desktop, {configurable: true, enumerable: true,
                get, set: value => {original = value; redirect = adapt(value);}});
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
