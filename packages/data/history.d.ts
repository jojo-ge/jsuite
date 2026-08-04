/**
 * Record the current state of `.data` as a commit in its own git repo.
 * Fire-and-forget: never awaited on a request path, never throws, and a
 * failure never fails the write that triggered it. Bursts coalesce into one
 * commit. Disabled by `JSUITE_HISTORY=0`.
 *
 * @param message what changed, e.g. `jticket: TICK-5`
 */
export declare function snapshotData(message: string): void

/** Wait for any in-flight snapshot. For tests and shutdown, not request paths. */
export declare function flushHistory(): Promise<void>
