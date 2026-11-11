import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reviewBelongsTo } from '../server/utils/jreview'

// One route family per review operation (TICK-959). A human's action on a
// review — retry or skip a reviewer, retry triage, file findings, Post to PR —
// goes through /api/projects/:id/reviews/:key/*, whose projectReview() guard
// 404s a review that isn't the project's. /api/reviews keeps only what a
// session hands back (findings, consensus), reads, watch, create and delete.

const API = join(__dirname, '..', 'server', 'api')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('review routes', () => {
  it('/api/reviews serves only reads, watch, create/delete and the session hand-backs', () => {
    const files = filesUnder(join(API, 'reviews')).map((f) => relative(join(API, 'reviews'), f)).sort()
    expect(files).toEqual([
      '[key].delete.ts',
      '[key].get.ts',
      '[key]/consensus.post.ts',
      '[key]/findings.post.ts',
      '[key]/watch.get.ts',
      'index.get.ts',
      'index.post.ts',
    ])
  })

  it('the project-scoped family carries every human action', () => {
    const files = filesUnder(join(API, 'projects', '[id]', 'reviews', '[key]')).map((f) => relative(join(API, 'projects', '[id]', 'reviews', '[key]'), f))
    expect(files.sort()).toEqual(['action.post.ts', 'pr-comments.post.ts', 'tickets.post.ts'])
  })
})

describe('reviewBelongsTo', () => {
  it('is the project the review was started for, or its consensus project', () => {
    expect(reviewBelongsTo({ project: 'PROJ-1' }, 'PROJ-1')).toBe(true)
    expect(reviewBelongsTo({ consensus: { projectKey: 'PROJ-2' } }, 'PROJ-2')).toBe(true)
    expect(reviewBelongsTo({ project: 'PROJ-1' }, 'PROJ-2')).toBe(false)
  })

  it("is the project a pre-project review's findings were filed into", () => {
    const legacy = { tickets: { projectKey: 'PROJ-3', ticketKeys: [], createdAt: '' } }
    expect(reviewBelongsTo(legacy, 'PROJ-3')).toBe(true)
    expect(reviewBelongsTo(legacy, 'PROJ-4')).toBe(false)
  })

  it('a review with no project belongs to none', () => {
    expect(reviewBelongsTo({}, 'PROJ-1')).toBe(false)
  })
})
