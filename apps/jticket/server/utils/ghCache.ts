// The cache in front of jTicket's GitHub reads — every `gh` list or lookup a
// page renders from, and the `git ls-remote` beside them. Each is a network
// round trip of one to five seconds, so a page never waits on one twice:
//
//   fresh   (younger than `fresh`)  → the held answer, no call
//   stale   (younger than `stale`)  → the held answer NOW, and one refresh
//                                     in the background; the caller is told
//                                     `refreshing` so the page can ask again
//   missing, older, or `force`      → wait for the call
//
// Calls for the same key share one in-flight promise. A failure is never
// kept: a miss rethrows it, a background refresh that fails leaves the held
// answer in place and isn't retried for RETRY_MS. In memory only — a restart
// starts cold. Tests: tests/ghCache.test.ts.

export interface Cached<T> {
  value: T
  /** When the value was read from GitHub (ms since epoch). */
  fetchedAt: number
  /** A fresher copy is being fetched: ask again shortly. */
  refreshing: boolean
}

export interface GhCacheOptions<T> {
  /** How long an answer is served without a call. */
  fresh?: number
  /** How long an answer is served while a refresh runs behind it. */
  stale?: number
  /** Skip the cache and wait for a fresh answer (a reload button). */
  force?: boolean
  /** false keeps this answer out of the cache (a degraded, offline one). */
  keep?: (value: T) => boolean
}

export const GH_FRESH_MS = 60_000
export const GH_STALE_MS = 60 * 60_000
export const GH_RETRY_MS = 30_000
const MAX_ENTRIES = 400

interface Entry {
  has: boolean
  value?: unknown
  at: number
  failedAt: number
  inflight?: Promise<unknown>
}

const entries = new Map<string, Entry>()

/** A cache key: the kind of read, the repo, then whatever narrows it. */
export function ghKey(kind: string, repo: string, ...parts: (string | number)[]): string {
  return [kind, repo, ...parts].join('\n')
}

export async function ghCached<T>(key: string, load: () => Promise<T>, opts: GhCacheOptions<T> = {}): Promise<Cached<T>> {
  const now = Date.now()
  const hit = entries.get(key)
  if (hit?.has && !opts.force) {
    const age = now - hit.at
    if (age < (opts.fresh ?? GH_FRESH_MS)) return { value: hit.value as T, fetchedAt: hit.at, refreshing: false }
    if (age < (opts.stale ?? GH_STALE_MS)) {
      if (now - hit.failedAt >= GH_RETRY_MS) refresh(key, hit, load, opts.keep).catch(() => {})
      return { value: hit.value as T, fetchedAt: hit.at, refreshing: !!hit.inflight }
    }
  }
  const entry = hit ?? hold(key)
  const value = await refresh(key, entry, load, opts.keep)
  return { value, fetchedAt: Date.now(), refreshing: false }
}

/** Drop every held answer whose key starts with `prefix` (after a write). */
export function forgetGh(prefix: string): void {
  for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key)
}

function hold(key: string): Entry {
  const entry: Entry = { has: false, at: 0, failedAt: 0 }
  entries.set(key, entry)
  // Oldest key first: a Map iterates in insertion order.
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  return entry
}

function refresh<T>(key: string, entry: Entry, load: () => Promise<T>, keep?: (value: T) => boolean): Promise<T> {
  if (entry.inflight) return entry.inflight as Promise<T>
  const call = (async () => load())()
    .then(
      (value) => {
        if (!keep || keep(value)) Object.assign(entry, { has: true, value, at: Date.now(), failedAt: 0 })
        return value
      },
      (err) => {
        entry.failedAt = Date.now()
        throw err
      },
    )
    .finally(() => {
      entry.inflight = undefined
      // Nothing worth holding came back: don't leave an empty slot behind.
      if (!entry.has && entries.get(key) === entry) entries.delete(key)
    })
  entry.inflight = call
  return call
}
