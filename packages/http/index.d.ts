/**
 * The line of text to show for a failed `$fetch`/`useFetch` call.
 *
 * Reads the route's own message first (`data.message`), then ofetch's transport
 * line (`error.message`), then H3's status reason (`data.statusMessage`), then
 * `fallback` — see index.mjs for why that order.
 *
 * Takes `unknown`: a catch block does not have to annotate or cast its error.
 */
export declare function fetchErrorMessage(error: unknown, fallback?: string): string
