/** The shared `.data` root — `<monorepo root>/.data`, or `$JSUITE_DATA_DIR`. */
export declare function dataRoot(): string

/** `<root>/.data/<app>`, created if missing. */
export declare function appDataDir(app: string): string

/** A path inside an app's data dir. Parent directories are created. */
export declare function appDataFile(app: string, ...parts: string[]): string

/**
 * Write a file so a reader never sees it half-written: the content goes to a
 * sibling `.tmp` and is then renamed over the target, which is atomic within a
 * filesystem. Use this for every `.data` write — plain `writeFile` has already
 * produced torn chart files here.
 */
export declare function writeTextAtomic(path: string, text: string): Promise<void>

/** `writeTextAtomic` for a value that should land as pretty-printed JSON. */
export declare function writeJsonAtomic(path: string, value: unknown): Promise<void>
