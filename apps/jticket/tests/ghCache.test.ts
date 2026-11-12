import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetGh, GH_FRESH_MS, GH_RETRY_MS, GH_STALE_MS, ghCached, ghKey } from '../server/utils/ghCache'

// The cache in front of every GitHub read: fresh answers cost no call, aged
// ones are served at once and refreshed behind the page, and only a miss (or
// force) waits.

let n = 0
let key = ''
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  key = ghKey('test', `/repo-${++n}`) // a fresh key per test: the cache is module state
})
afterEach(() => vi.useRealTimers())

describe('ghCached', () => {
  it('a miss waits for the call; a fresh hit makes none', async () => {
    const load = vi.fn(async () => 'one')
    const t0 = Date.now()
    expect(await ghCached(key, load)).toEqual({ value: 'one', fetchedAt: t0, refreshing: false })

    vi.setSystemTime(t0 + GH_FRESH_MS - 1)
    expect(await ghCached(key, load)).toEqual({ value: 'one', fetchedAt: t0, refreshing: false })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('an aged answer is served at once, marked refreshing, and replaced behind the caller', async () => {
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    const t0 = Date.now()
    await ghCached(key, load)

    vi.setSystemTime(t0 + GH_FRESH_MS + 1)
    expect(await ghCached(key, load)).toEqual({ value: 'old', fetchedAt: t0, refreshing: true })
    await flush()
    expect(await ghCached(key, load)).toMatchObject({ value: 'new', refreshing: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('past the stale window it waits again', async () => {
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    await ghCached(key, load)
    vi.setSystemTime(Date.now() + GH_STALE_MS + 1)
    expect(await ghCached(key, load)).toMatchObject({ value: 'new', refreshing: false })
  })

  it('force waits for a fresh answer inside the fresh window', async () => {
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    await ghCached(key, load)
    expect(await ghCached(key, load, { force: true })).toMatchObject({ value: 'new', refreshing: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('callers at once share one call', async () => {
    const load = vi.fn(async () => 'one')
    const [a, b] = await Promise.all([ghCached(key, load), ghCached(key, load)])
    expect(a.value).toBe('one')
    expect(b.value).toBe('one')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a failed miss rethrows and is not kept', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('gh: offline')).mockResolvedValueOnce('back')
    await expect(ghCached(key, load)).rejects.toThrow('gh: offline')
    expect(await ghCached(key, load)).toMatchObject({ value: 'back' })
  })

  it('a failed background refresh keeps the held answer and backs off before retrying', async () => {
    const load = vi.fn().mockResolvedValueOnce('held').mockRejectedValueOnce(new Error('gh: offline')).mockResolvedValueOnce('new')
    const t0 = Date.now()
    await ghCached(key, load)

    vi.setSystemTime(t0 + GH_FRESH_MS + 1)
    expect(await ghCached(key, load)).toMatchObject({ value: 'held', refreshing: true })
    await flush()
    // The refresh failed: still the held answer, and no call per poll.
    expect(await ghCached(key, load)).toMatchObject({ value: 'held', refreshing: false })
    expect(await ghCached(key, load)).toMatchObject({ value: 'held', refreshing: false })
    expect(load).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + GH_RETRY_MS + 1)
    expect(await ghCached(key, load)).toMatchObject({ value: 'held', refreshing: true })
    await flush()
    expect(await ghCached(key, load)).toMatchObject({ value: 'new', refreshing: false })
  })

  it('keep: false returns the answer without holding it', async () => {
    const load = vi.fn().mockResolvedValueOnce({ slug: null }).mockResolvedValueOnce({ slug: 'o/r' })
    const keep = (v: { slug: string | null }) => !!v.slug
    expect((await ghCached(key, load, { keep })).value).toEqual({ slug: null })
    expect((await ghCached(key, load, { keep })).value).toEqual({ slug: 'o/r' })
    expect((await ghCached(key, load, { keep })).value).toEqual({ slug: 'o/r' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('forgetGh drops every key under a prefix, and an answer already on its way is not written back', async () => {
    const repo = `/repo-${n}`
    const page = ghKey('prs', repo, 'page', 'q', 25, '')
    const other = ghKey('prs', `${repo}-other`, 'page', 'q', 25, '')
    let release!: (v: string) => void
    const slow = vi.fn(() => new Promise<string>((r) => { release = r }))
    const pending = ghCached(page, slow)
    await ghCached(other, async () => 'theirs')

    forgetGh(ghKey('prs', repo, ''))
    release('late')
    expect((await pending).value).toBe('late')

    const load = vi.fn(async () => 'fresh')
    expect((await ghCached(page, load)).value).toBe('fresh')
    expect(load).toHaveBeenCalledTimes(1)
    // A repo whose path merely starts with this one is untouched.
    const theirs = vi.fn(async () => 'again')
    expect((await ghCached(other, theirs)).value).toBe('theirs')
    expect(theirs).not.toHaveBeenCalled()
  })
})
