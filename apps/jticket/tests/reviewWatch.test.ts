import { describe, expect, it } from 'vitest'
import {
  pendingReportKeys,
  REVIEW_CLOSE_RETRY_MS,
  REVIEW_CLOSE_WINDOW_MS,
  reviewSweepDue,
  settleReviewers,
} from '../server/utils/reviewWatch'
import { isReviewTab, type Review, type Reviewer } from '../app/utils/reviewTypes'

const AT = '2026-11-11T00:00:00.000Z'

function review(reviewers: Reviewer['status'][], over: Partial<Review> = {}): Review {
  return {
    format: 'j-review',
    version: 1,
    key: 'k',
    title: 't',
    repoPath: '/repo',
    branch: 'b',
    pr: null,
    base: 'main',
    workdir: '/repo',
    worktree: false,
    status: 'reviewing',
    reviewers: reviewers.map((status, i) => ({ n: i + 1, docKey: `jreview-k-r${i + 1}`, status })),
    triage: { docKey: 'jreview-k-triage', status: 'waiting' },
    findings: [],
    tickets: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  }
}

describe('review watcher — reports landing', () => {
  it('marks a reviewer done when its document lands, even one whose dispatch failed', () => {
    const r = review(['running', 'failed', 'running'])
    const step = settleReviewers(r, new Set(['jreview-k-r1', 'jreview-k-r2']), AT)
    expect(step).toEqual({ changed: true, fireTriage: false })
    expect(r.reviewers.map((x) => x.status)).toEqual(['done', 'done', 'running'])
    expect(r.reviewers[1]!.doneAt).toBe(AT)
    expect(r.status).toBe('reviewing')
  })

  it('claims triage once every reviewer is settled and one report is in', () => {
    const r = review(['done', 'skipped', 'running'])
    expect(settleReviewers(r, new Set(['jreview-k-r3']), AT)).toEqual({ changed: true, fireTriage: true })
    expect(r.status).toBe('triaging')
    // The claim is the status: a second tick over the same review fires nothing.
    expect(settleReviewers(r, new Set(['jreview-k-r3']), AT)).toEqual({ changed: false, fireTriage: false })
  })

  it('never triages a review whose every reviewer was skipped', () => {
    const r = review(['skipped', 'skipped'])
    expect(settleReviewers(r, new Set(), AT)).toEqual({ changed: false, fireTriage: false })
  })

  it('makes a consensus or agreement review wait for every report — a skip is no vote', () => {
    const consensus = review(['done', 'skipped'], { consensus: { projectKey: 'PROJ-1' } })
    expect(settleReviewers(consensus, new Set(), AT).fireTriage).toBe(false)
    const agreement = review(['done', 'running'], { agreement: {}, project: 'PROJ-2' })
    expect(settleReviewers(agreement, new Set(), AT).fireTriage).toBe(false)
    expect(settleReviewers(agreement, new Set(['jreview-k-r2']), AT).fireTriage).toBe(true)
  })

  it('only looks up the reports still outstanding', () => {
    expect(pendingReportKeys(review(['done', 'queued', 'skipped', 'failed']))).toEqual(['jreview-k-r2', 'jreview-k-r4'])
    expect(pendingReportKeys(review(['running'], { status: 'triaging' }))).toEqual([])
  })
})

describe('review watcher — the one sweep of review tabs', () => {
  const now = Date.parse(AT)
  const finished = (over: Partial<Review> = {}) =>
    review(['done', 'done'], { status: 'triaged', triage: { docKey: 'd', status: 'done', doneAt: AT }, ...over })

  it('sweeps a review that just handed back, then backs off between tries', () => {
    expect(reviewSweepDue(finished(), now + 1_000)).toBe(true)
    expect(reviewSweepDue(finished({ status: 'ticketed' }), now + 1_000)).toBe(true)
    expect(reviewSweepDue(finished(), now + 5_000, now + 1_000)).toBe(false)
    expect(reviewSweepDue(finished(), now + 1_000 + REVIEW_CLOSE_RETRY_MS, now + 1_000)).toBe(true)
  })

  it('leaves live reviews, finished-and-swept ones, and ones past the window alone', () => {
    expect(reviewSweepDue(finished({ status: 'reviewing' }), now)).toBe(false)
    expect(reviewSweepDue(finished({ status: 'triaging' }), now)).toBe(false)
    expect(reviewSweepDue(finished({ panesClosedAt: AT }), now)).toBe(false)
    expect(reviewSweepDue(finished(), now + REVIEW_CLOSE_WINDOW_MS + 1)).toBe(false)
    expect(reviewSweepDue(finished({ triage: { docKey: 'd', status: 'done' } }), now)).toBe(false)
  })

  it('comes back for the worktree once the panes are closed', () => {
    expect(reviewSweepDue(finished({ panesClosedAt: AT, worktree: true }), now)).toBe(true)
    expect(reviewSweepDue(finished({ panesClosedAt: AT, worktree: true, worktreeRemovedAt: AT }), now)).toBe(false)
  })

  it("matches a review's reviewer and triage tabs, not a sibling review's", () => {
    expect(isReviewTab('review proj-4-loop-1', 'proj-4-loop-1')).toBe(true)
    expect(isReviewTab('review proj-4-loop-1 · 2', 'proj-4-loop-1')).toBe(true)
    expect(isReviewTab('triage proj-4-loop-1 2', 'proj-4-loop-1')).toBe(true)
    expect(isReviewTab('review proj-4-loop-1-2', 'proj-4-loop-1')).toBe(false)
    expect(isReviewTab('PROJ-4', 'proj-4-loop-1')).toBe(false)
  })
})
