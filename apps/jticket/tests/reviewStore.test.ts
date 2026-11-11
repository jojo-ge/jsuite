import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appDataDir } from '@jsuite/data'
import {
  deleteReview,
  listReviews,
  readReview,
  reviewMeta,
  sanitizeReviewKey,
  uniqueReviewKey,
  updateReview,
  writeReview,
} from '../server/utils/reviewStore'
import type { Review } from '../app/utils/reviewTypes'

// The review engine's store, as jReview kept it: one j-review file per review
// in .data/jreview/<key>.json (the per-worker throwaway data root here).

function review(key: string, over: Partial<Review> = {}): Review {
  return {
    format: 'j-review',
    version: 1,
    key,
    title: `title ${key}`,
    repoPath: '/repo',
    branch: 'feature',
    pr: null,
    base: 'main',
    workdir: '/repo',
    worktree: false,
    status: 'reviewing',
    reviewers: [
      { n: 1, docKey: `jreview-${key}-r1`, status: 'running' },
      { n: 2, docKey: `jreview-${key}-r2`, status: 'queued' },
    ],
    triage: { docKey: `jreview-${key}-triage`, status: 'waiting' },
    findings: [],
    tickets: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }
}

describe('review store', () => {
  it('keeps reviews in .data/jreview — the directory keeps its name', async () => {
    await writeReview(review('kept-name'))
    const raw = JSON.parse(readFileSync(join(appDataDir('jreview'), 'kept-name.json'), 'utf8'))
    expect(raw).toMatchObject({ format: 'j-review', key: 'kept-name' })
    expect(await readReview('kept-name')).toMatchObject({ key: 'kept-name', status: 'reviewing' })
  })

  it('loads records written by jReview as they are, and skips files that are not reviews', async () => {
    const dir = appDataDir('jreview')
    mkdirSync(dir, { recursive: true })
    // A record exactly as jReview's own store wrote it, pretty-printed, with fields this code never sets.
    writeFileSync(join(dir, 'legacy-one.json'), JSON.stringify({ ...review('legacy-one', { createdAt: '2026-10-01T00:00:00.000Z' }), pr: { number: 7, title: 't', url: 'https://github.com/o/r/pull/7', headRefName: 'h', baseRefName: 'main', isDraft: false } }, null, 2) + '\n')
    // jReview's picker history sits in the same directory; it is not a review.
    writeFileSync(join(dir, 'repos.json'), JSON.stringify([{ path: '/repo', lastUsedAt: 'x' }]))
    writeFileSync(join(dir, 'torn.json'), '{ "format": "j-rev')
    const keys = (await listReviews()).map((r) => r.key)
    expect(keys).toContain('legacy-one')
    expect(keys).not.toContain('repos')
    expect(keys).not.toContain('torn')
    expect(await readReview('repos')).toBeNull()
    expect(await readReview('torn')).toBeNull()
    expect((await readReview('legacy-one'))!.pr!.number).toBe(7)
  })

  it('lists newest first', async () => {
    await writeReview(review('older', { createdAt: '2026-11-02T00:00:00.000Z' }))
    await writeReview(review('newer', { createdAt: '2026-11-03T00:00:00.000Z' }))
    const keys = (await listReviews()).map((r) => r.key)
    expect(keys.indexOf('newer')).toBeLessThan(keys.indexOf('older'))
  })

  it('sanitizes keys and picks a free one', async () => {
    expect(sanitizeReviewKey('PROJ-4 · auto loop 1 / app')).toBe('proj-4-auto-loop-1-app')
    expect(sanitizeReviewKey('../../etc')).toBe('etc')
    await writeReview(review('taken'))
    expect(await uniqueReviewKey('Taken')).toBe('taken-2')
    expect(await uniqueReviewKey('fresh one')).toBe('fresh-one')
  })

  it('serialises updates per key, so concurrent writers never lose each other', async () => {
    await writeReview(review('busy'))
    await Promise.all([
      updateReview('busy', async (r) => {
        await new Promise((res) => setTimeout(res, 20))
        r.reviewers[0]!.status = 'done'
      }),
      updateReview('busy', (r) => {
        r.reviewers[1]!.status = 'running'
      }),
    ])
    const r = await readReview('busy')
    expect(r!.reviewers.map((x) => x.status)).toEqual(['done', 'running'])
  })

  it("doesn't rewrite the file when the update says nothing changed, and 404s a missing review", async () => {
    await writeReview(review('quiet'))
    const before = (await readReview('quiet'))!.updatedAt
    await new Promise((res) => setTimeout(res, 5))
    await updateReview('quiet', () => false)
    expect((await readReview('quiet'))!.updatedAt).toBe(before)
    await expect(updateReview('nope', () => {})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('deletes a review', async () => {
    await writeReview(review('gone'))
    await deleteReview('gone')
    expect(await readReview('gone')).toBeNull()
  })

  it('summarises a review for the lists', () => {
    const meta = reviewMeta(review('m', {
      status: 'triaged',
      consensus: { projectKey: 'PROJ-1', loop: 2 },
      findings: [
        { id: 'f1', title: 'a', severity: 'high', category: 'bug', summary: '', detail: '', reviewers: [1], ticketKey: 'T-1' },
        { id: 'f2', title: 'b', severity: 'low', category: 'bug', summary: '', detail: '', reviewers: [2] },
      ],
    }))
    expect(meta).toMatchObject({ key: 'm', findingCount: 2, ticketedCount: 1, reviewerCount: 2, reviewersDone: 0, consensus: true, loop: 2 })
  })
})
