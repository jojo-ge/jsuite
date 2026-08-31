import { describe, expect, it } from 'vitest'
import { appendFailures, clearFailures, loadFailures } from '../server/utils/failureStore'

let n = 0
const freshTarget = () => `t-${++n}`
const REPO = '/tmp/repo-failures'

const fail = (jobKind: string, message = 'boom') => ({ jobKind, message, at: new Date().toISOString() })

describe('failure store jobKind merge', () => {
  it('keeps failures from different jobs side by side', () => {
    const key = freshTarget()
    appendFailures(REPO, key, [fail('analyze')])
    appendFailures(REPO, key, [fail('chain:a')])
    expect(loadFailures(REPO, key).map((f) => f.jobKind).sort()).toEqual(['analyze', 'chain:a'])
  })

  it('replaces prior failures of the same jobKind', () => {
    const key = freshTarget()
    appendFailures(REPO, key, [fail('detail', 'old')])
    appendFailures(REPO, key, [fail('detail', 'new')])
    const rows = loadFailures(REPO, key).filter((f) => f.jobKind === 'detail')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.message).toBe('new')
  })

  it('clearFailures removes only matching jobKinds', () => {
    const key = freshTarget()
    appendFailures(REPO, key, [fail('analyze'), fail('chains-scope'), fail('chain:a'), fail('chain:b')])
    clearFailures(REPO, key, (k) => k === 'chains-scope' || k.startsWith('chain:'))
    expect(loadFailures(REPO, key).map((f) => f.jobKind)).toEqual(['analyze'])
  })

  it('drops the row entirely when everything is cleared', () => {
    const key = freshTarget()
    appendFailures(REPO, key, [fail('analyze')])
    clearFailures(REPO, key, () => true)
    expect(loadFailures(REPO, key)).toEqual([])
  })
})
