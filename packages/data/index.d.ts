/** The shared `.data` root — `<monorepo root>/.data`, or `$JSUITE_DATA_DIR`. */
export declare function dataRoot(): string

/** The monorepo root itself — the checkout `jsuite root` prints. */
export declare function suiteRoot(): string

/** `<root>/.data/<app>`, created if missing. */
export declare function appDataDir(app: string): string

/** A path inside an app's data dir. Parent directories are created. */
export declare function appDataFile(app: string, ...parts: string[]): string
