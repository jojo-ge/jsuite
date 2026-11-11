import { describe, expect, it } from 'vitest'
import { deleteDocumentPrompt, filterLibrary, libraryEntries, readerPath, trackerDocFor } from '../app/utils/documentLibrary'

const meta = (key: string, title: string, extra: Record<string, unknown> = {}) => ({
  key,
  title,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  blockCount: 1,
  chartCount: 0,
  noteCount: 0,
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
