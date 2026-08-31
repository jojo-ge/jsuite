import { describe, expect, it } from 'vitest'
import {
  clearReviewDispatch,
  getReviewDispatch,
  markReviewToolPosted,
  pendingToolsFor,
  registerReviewDispatch,
  targetDispatches,
} from '../server/utils/herdrReview'

let n = 0
const freshTarget = () => `pr-${++n}`
const REPO = '/tmp/repo'

const base = (number: string, job?: any) => ({
  repo: REPO,
  number,
  ...(job ? { job } : {}),
  startedAt: Date.now(),
  agent: 'a',
  workspaceId: 'w',
  tabId: 't',
})

describe('job-keyed dispatch registry', () => {
  it('defaults to the analyze job with the five-tool pending set', () => {
    const key = freshTarget()
    const d = registerReviewDispatch(base(key))
    expect(d.job).toBe('analyze')
    expect([...d.pending].sort()).toEqual(['findings', 'questions', 'rating', 'risk', 'tour'])
    expect(getReviewDispatch(REPO, key)).toBe(d)
  })

  it('gives single-artifact jobs their own pending sets', () => {
    expect(pendingToolsFor('detail')).toEqual(['tour'])
    expect(pendingToolsFor('chains-scope')).toEqual(['chains'])
    expect(pendingToolsFor('chain:x')).toEqual(['tour'])
  })

  it('keeps jobs for the same target independent', () => {
    const key = freshTarget()
    registerReviewDispatch(base(key))
    registerReviewDispatch(base(key, 'detail'))
    registerReviewDispatch(base(key, 'chain:one'))
    expect(targetDispatches(REPO, key)).toHaveLength(3)
    // analyze sorts first
    expect(targetDispatches(REPO, key)[0]!.job).toBe('analyze')

    clearReviewDispatch(REPO, key, 'detail')
    expect(getReviewDispatch(REPO, key, 'detail')).toBeNull()
    expect(getReviewDispatch(REPO, key)).not.toBeNull()
    expect(getReviewDispatch(REPO, key, 'chain:one')).not.toBeNull()
  })

  it('self-clears a job when its last pending tool posts', () => {
    const key = freshTarget()
    registerReviewDispatch(base(key, 'chain:solo'))
    markReviewToolPosted(REPO, key, 'chain:solo', 'tour')
    expect(getReviewDispatch(REPO, key, 'chain:solo')).toBeNull()
  })

  it('does not complete analyze from another job\'s artifact', () => {
    const key = freshTarget()
    registerReviewDispatch(base(key))
    markReviewToolPosted(REPO, key, 'detail', 'tour')
    const analyze = getReviewDispatch(REPO, key)!
    expect(analyze.pending.has('tour')).toBe(true)
  })

  it('re-registering a job replaces only that job', () => {
    const key = freshTarget()
    const first = registerReviewDispatch(base(key, 'detail'))
    const second = registerReviewDispatch(base(key, 'detail'))
    expect(getReviewDispatch(REPO, key, 'detail')).toBe(second)
    expect(getReviewDispatch(REPO, key, 'detail')).not.toBe(first)
  })
})
