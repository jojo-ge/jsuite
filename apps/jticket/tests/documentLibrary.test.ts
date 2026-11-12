import { describe, expect, it } from 'vitest'
import { LIBRARY_KINDS } from '@jsuite/documents/tags'
import { DOCUMENT_KIND_META, deleteDocumentPrompt, documentKindMeta, filterLibrary, libraryEntries, libraryTags, readerPath, showsEverything, toggleTag, trackerDocFor } from '../app/utils/documentLibrary'

const meta = (key: string, title: string, extra: Record<string, unknown> = {}) => ({
  key,
  title,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  blockCount: 1,
  chartCount: 0,
  noteCount: 0,
  tags: [] as string[],
  ...extra,
})

describe('readerPath', () => {
  it('is the in-app reader route for a pool key', () => {
    expect(readerPath('how-caching-works')).toBe('/e/how-caching-works')
  })
  it('escapes a key that is not URL-safe', () => {
    expect(readerPath('a b/c')).toBe('/e/a%20b%2Fc')
  })
})

describe('libraryEntries', () => {
  it('keeps every pool document, in pool order, and marks the ones a tracker doc wraps', () => {
    const pool = [meta('rev-1', 'Reviewer 1 report'), meta('spec', 'Cart spec'), meta('essay', 'How X works')]
    const docs = [{ key: 'DOC-4', documentKey: 'spec' }]
    const out = libraryEntries(pool, docs)
    expect(out.map((e) => e.key)).toEqual(['rev-1', 'spec', 'essay'])
    expect(out.find((e) => e.key === 'spec')?.trackedAs).toBe('DOC-4')
    expect(out.find((e) => e.key === 'rev-1')?.trackedAs).toBeNull()
  })
  it('ignores tracker docs with no document key', () => {
    const out = libraryEntries([meta('a', 'A')], [{ key: 'DOC-1', documentKey: '' }])
    expect(out[0]!.trackedAs).toBeNull()
  })
})

describe('trackerDocFor', () => {
  it('finds the DOC-n that wraps a pool key, or nothing', () => {
    const docs = [{ key: 'DOC-1', documentKey: 'a' }, { key: 'DOC-2', documentKey: 'b' }]
    expect(trackerDocFor('b', docs)?.key).toBe('DOC-2')
    expect(trackerDocFor('c', docs)).toBeUndefined()
  })
})

describe('filterLibrary', () => {
  const entries = libraryEntries(
    [
      meta('rev-1', 'Reviewer 1 report', { kicker: 'jReview' }),
      meta('spec', 'Cart spec', { subtitle: 'Persist across refresh' }),
      meta('essay', 'How caching works'),
    ],
    [{ key: 'DOC-12', documentKey: 'spec' }],
  )
  it('returns everything for an empty query', () => {
    expect(filterLibrary(entries, '  ')).toHaveLength(3)
  })
  it('matches title, subtitle, kicker, pool key and DOC key, case-insensitively', () => {
    expect(filterLibrary(entries, 'CACHING').map((e) => e.key)).toEqual(['essay'])
    expect(filterLibrary(entries, 'refresh').map((e) => e.key)).toEqual(['spec'])
    expect(filterLibrary(entries, 'jreview').map((e) => e.key)).toEqual(['rev-1'])
    expect(filterLibrary(entries, 'rev-').map((e) => e.key)).toEqual(['rev-1'])
    expect(filterLibrary(entries, 'doc-12').map((e) => e.key)).toEqual(['spec'])
  })
  it('needs every word to match', () => {
    expect(filterLibrary(entries, 'cart refresh').map((e) => e.key)).toEqual(['spec'])
    expect(filterLibrary(entries, 'cart caching')).toEqual([])
  })
})

describe('deleteDocumentPrompt', () => {
  it('names the DOC-n the delete would leave empty', () => {
    expect(deleteDocumentPrompt('Cart spec', 'DOC-4')).toContain('DOC-4 wraps it')
    expect(deleteDocumentPrompt('Essay', null)).not.toContain('wraps')
  })
})

describe('filterLibrary — tags and the kinds the library lists', () => {
  const entries = libraryEntries(
    [
      meta('jreview-1', 'PR #12 — reviewer 1', { tags: ['review-output'] }),
      meta('slice-3', 'PROJ-1 slice report · before step 3', { tags: ['slice-report'] }),
      meta('spec', 'Cart refresh spec', { tags: ['spec'] }),
      meta('essay', 'How caching works', { tags: ['explainer'] }),
      meta('old', 'Written before tags', { tags: undefined }),
    ],
    [],
  )
  const keys = (out: { key: string }[]) => out.map((e) => e.key)

  it('lists the library kinds and anything not yet tagged; the rest waits to be asked for', () => {
    expect(keys(filterLibrary(entries, ''))).toEqual(['spec', 'essay', 'old'])
    expect(keys(filterLibrary(entries, '', { all: true }))).toEqual(['jreview-1', 'slice-3', 'spec', 'essay', 'old'])
  })
  it('keeps the other kinds out of search too, until asked', () => {
    expect(keys(filterLibrary(entries, 'reviewer'))).toEqual([])
    expect(keys(filterLibrary(entries, 'slice'))).toEqual([])
    expect(keys(filterLibrary(entries, 'reviewer', { all: true }))).toEqual(['jreview-1'])
  })
  it('picking a tag outside the library kinds asks for them', () => {
    expect(showsEverything({ tags: ['spec'] })).toBe(false)
    expect(showsEverything({ tags: ['slice-report'] })).toBe(true)
    expect(keys(filterLibrary(entries, '', { tags: ['review-output'] }))).toEqual(['jreview-1'])
  })
  it('a document must carry every picked tag', () => {
    expect(keys(filterLibrary(entries, '', { tags: ['spec'] }))).toEqual(['spec'])
    expect(keys(filterLibrary(entries, '', { tags: ['spec', 'explainer'] }))).toEqual([])
  })
  it('a query matches a tag', () => {
    expect(keys(filterLibrary(entries, 'explainer'))).toEqual(['essay'])
  })
  it('keeps a document the full-text search matched, still under the tag and kind rules', () => {
    const contentHits = new Set(['essay', 'jreview-1'])
    expect(keys(filterLibrary(entries, 'redis', { contentHits }))).toEqual(['essay'])
    expect(keys(filterLibrary(entries, 'redis', { contentHits, tags: ['spec'] }))).toEqual([])
    expect(keys(filterLibrary(entries, 'redis', { contentHits, all: true }))).toEqual(['jreview-1', 'essay'])
  })
})

describe('libraryTags', () => {
  it('counts the tags in use on the rows given, most used first', () => {
    const entries = libraryEntries(
      [meta('a', 'A', { tags: ['spec'] }), meta('b', 'B', { tags: ['spec'] }), meta('c', 'C', { tags: ['decision'] }), meta('d', 'D')],
      [],
    )
    expect(libraryTags(entries)).toEqual([
      { tag: 'spec', count: 2 },
      { tag: 'decision', count: 1 },
    ])
  })
})

describe('toggleTag', () => {
  it('adds a tag that is off and drops one that is on', () => {
    expect(toggleTag(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleTag(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('documentKindMeta', () => {
  it('gives every kind the library lists, and every kind the engine files, its own look', () => {
    const kinds = [...LIBRARY_KINDS, 'review-output', 'slice-report', 'outcome-report']
    for (const kind of kinds) expect(DOCUMENT_KIND_META[kind], kind).toBeDefined()
    const looks = Object.values(DOCUMENT_KIND_META).map((m) => `${m.icon} ${m.text}`)
    expect(new Set(looks).size).toBe(looks.length)
  })
  it('keeps an unknown tag under its own name, and says when there is none', () => {
    expect(documentKindMeta('post-mortem').label).toBe('post-mortem')
    expect(documentKindMeta(undefined).label).toBe('Untagged')
    expect(documentKindMeta('post-mortem').icon).toBe(documentKindMeta(null).icon)
  })
})
