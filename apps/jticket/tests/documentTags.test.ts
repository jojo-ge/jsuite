import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { listDocs, readDoc, setDocTags } from '@jsuite/documents/store'
import { blocksText, cleanTag, cleanTags, listedByDefault, matchDocument, snippetAround, tagCounts } from '@jsuite/documents/tags'
import type { Explainer } from '@jsuite/documents/types'

const doc = (key: string, extra: Partial<Explainer> = {}): Explainer => ({
  format: 'j-explain',
  version: 1,
  key,
  title: 'How the cache warms',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  blocks: [
    { id: 'b1', type: 'prose', md: 'Redis is filled by the nightly job before the first request lands.' },
    { id: 'b2', type: 'code', lang: 'typescript', file: 'warm.ts', code: 'await warmCache(tenant)' },
    { id: 'b3', type: 'steps', title: 'Rollout', steps: [{ title: 'Flip the flag', md: 'Only for the canary tenant.' }] } as never,
  ],
  glossary: {},
  ...extra,
})

describe('cleanTags', () => {
  it('normalises to lowercase kebab-case', () => {
    expect(cleanTag('  Post Mortem! ')).toBe('post-mortem')
    expect(cleanTag('plan:asset')).toBe('plan-asset')
    expect(cleanTag('---')).toBe('')
  })
  it('dedupes after normalising, keeps order, drops empties, caps the list', () => {
    expect(cleanTags(['Spec', 'spec', '', 'Check out', 7])).toEqual(['spec', 'check-out', '7'])
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(8)
  })
  it('reads a comma-separated string, and anything else as no tags', () => {
    expect(cleanTags('spec, auth')).toEqual(['spec', 'auth'])
    expect(cleanTags(undefined)).toEqual([])
    expect(cleanTags({ a: 1 })).toEqual([])
  })
})

describe('listedByDefault', () => {
  it('lists the kinds people read, and a document with no tag yet', () => {
    for (const kind of ['explainer', 'research', 'decision', 'spec', 'proposal']) expect(listedByDefault({ tags: [kind] })).toBe(true)
    expect(listedByDefault({ tags: [] })).toBe(true)
    expect(listedByDefault({})).toBe(true)
  })
  it('leaves every other kind to be asked for', () => {
    for (const kind of ['review-output', 'slice-report', 'outcome-report', 'status-report', 'review-brief', 'something-new']) {
      expect(listedByDefault({ tags: [kind] })).toBe(false)
    }
  })
})

describe('tagCounts', () => {
  it('counts across documents, most used first then alphabetical', () => {
    expect(tagCounts([{ tags: ['b', 'a'] }, { tags: ['b'] }, {}, { tags: ['c'] }])).toEqual([
      { tag: 'b', count: 2 },
      { tag: 'a', count: 1 },
      { tag: 'c', count: 1 },
    ])
  })
})

describe('matchDocument', () => {
  it('matches everything on an empty query', () => {
    expect(matchDocument(doc('a'), '  ')).toEqual({})
  })
  it('matches the title, key or a tag with no snippet', () => {
    expect(matchDocument(doc('a'), 'CACHE warms')).toEqual({})
    expect(matchDocument(doc('cache-notes'), 'notes')).toEqual({})
    expect(matchDocument(doc('a', { tags: ['architecture'] }), 'architecture')).toEqual({})
  })
  it('matches block text — prose, code, nested step text — with a snippet around the hit', () => {
    expect(matchDocument(doc('a'), 'redis')?.snippet).toContain('Redis is filled by the nightly job')
    expect(matchDocument(doc('a'), 'warmCache')?.snippet).toContain('await warmCache(tenant)')
    expect(matchDocument(doc('a'), 'canary')?.snippet).toContain('canary tenant')
  })
  it('needs every word, across title and body together', () => {
    expect(matchDocument(doc('a'), 'cache nightly')).not.toBeNull()
    expect(matchDocument(doc('a'), 'cache kubernetes')).toBeNull()
  })
  it('does not match block plumbing — types, ids, languages', () => {
    expect(blocksText(doc('a').blocks)).not.toMatch(/prose|typescript|b1/)
    expect(matchDocument(doc('a'), 'typescript')).toBeNull()
  })
})

describe('snippetAround', () => {
  it('trims to one line with ellipses where it was cut', () => {
    const text = `${'x'.repeat(200)}\n\nthe needle sits here\n${'y'.repeat(300)}`
    const s = snippetAround(text, 'needle')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s).toContain('the needle sits here')
    expect(s).not.toContain('\n')
  })
})

// JSUITE_DATA_DIR points at a throwaway dir (vitest.config.ts).
const DIR = join(process.env.JSUITE_DATA_DIR!, 'jexplain')
const KEYS = ['tags-a', 'tags-b']

describe('the pool store', () => {
  beforeEach(() => {
    mkdirSync(DIR, { recursive: true })
    for (const key of KEYS) rmSync(join(DIR, `${key}.json`), { force: true })
    writeFileSync(join(DIR, 'tags-a.json'), JSON.stringify(doc('tags-a', { tags: ['architecture'] })))
    writeFileSync(join(DIR, 'tags-b.json'), JSON.stringify(doc('tags-b', { title: 'Untagged, from before tags' })))
  })
  const mine = async (q?: string) => (await listDocs({ q })).filter((d) => KEYS.includes(d.key))

  it('lists tags on every document — none for one written before tags', async () => {
    const out = await mine()
    expect(out.find((d) => d.key === 'tags-a')?.tags).toEqual(['architecture'])
    expect(out.find((d) => d.key === 'tags-b')?.tags).toEqual([])
  })
  it('searches the body and reports where it hit', async () => {
    const out = await mine('nightly')
    expect(out.map((d) => d.key).sort()).toEqual(KEYS)
    expect(out[0]!.snippet).toContain('nightly job')
    expect(await mine('kubernetes')).toEqual([])
  })
  it('re-tags in place without touching updatedAt or content', async () => {
    const before = await readDoc('tags-b')
    const after = await setDocTags('tags-b', ['Spec', 'spec', 'Check out'])
    expect(after?.tags).toEqual(['spec', 'check-out'])
    expect(after?.updatedAt).toBe(before?.updatedAt)
    expect(after?.blocks).toEqual(before?.blocks)
    expect((await mine()).find((d) => d.key === 'tags-b')?.tags).toEqual(['spec', 'check-out'])
  })
  it('answers null for a document that is not there', async () => {
    expect(await setDocTags('tags-nope', ['x'])).toBeNull()
  })
})
