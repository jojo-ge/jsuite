import { describe, expect, it } from 'vitest'
import { isRecordOnly } from '../app/utils/reviewFindings'
import type { Finding, Review } from '../app/utils/reviewTypes'
import { fileAgreementFindings, fileTriageFindings, stampPosted } from '../server/utils/reviewTickets'
import type { Project, Store } from '../server/utils/store'

// Findings filed on the store: an agreement review's verified findings become
// record-only tickets on its PR review project, a rerun matches the open ones
// instead of duplicating them, and Post to PR stamps the ticket (TICK-944).

const BASE = 'https://jticket.local'
const T1 = '2026-11-11T10:00:00.000Z'
const T2 = '2026-11-11T12:00:00.000Z'

const project = (over: Partial<Project> = {}): Project =>
  ({ id: 'p1', key: 'PROJ-7', title: 'PR #12 · Retry client', mode: 'prreview', share: null, ...over }) as Project

const store = (p: Project = project()): Store => ({ projects: [p], tickets: [], docs: [], prs: [], counters: { project: 7, ticket: 40, doc: 0, pr: 0 } }) as unknown as Store

const review = (key: string, loop: number): Pick<Review, 'key' | 'title' | 'pr' | 'triage' | 'agreement'> => ({
  key,
  title: `PROJ-7 · PR #12 · run ${loop}`,
  pr: { number: 12, title: 'Retry client', url: 'https://github.com/o/r/pull/12', baseRefName: 'main', headRefName: 'retry', isDraft: false },
  triage: { docKey: `jreview-${key}-triage`, status: 'done' },
  agreement: { loop },
})

const finding = (id: string, title: string, over: Partial<Finding> = {}): Finding => ({
  id,
  title,
  severity: 'high',
  category: 'correctness',
  file: 'src/retry.ts',
  line: 42,
  summary: 'The loop retries immediately.',
  detail: 'Failure scenario: a 429 is retried four times in 40ms.',
  reviewers: [1, 2],
  scope: 'in',
  verdict: 'confirmed',
  verification: 'Ran the client against a stub.',
  ...over,
})

describe('fileAgreementFindings', () => {
  it('files each verified finding as a record-only ticket carrying scope, verdict, file and line', () => {
    const s = store()
    const filing = fileAgreementFindings(s, s.projects[0]!, review('run-1', 1), [finding('f1', 'Retry loop never backs off')], T1, BASE)

    expect(filing.created).toHaveLength(1)
    const t = s.tickets[0]!
    expect(filing.byFinding.get('f1')).toBe(t.key)
    expect(t).toMatchObject({ projectId: 'p1', status: 'todo', type: 'bug', title: 'Retry loop never backs off', acceptanceCriteria: [], branch: '' })
    expect(t.finding).toEqual({ review: 'run-1', id: 'f1', severity: 'high', category: 'correctness', file: 'src/retry.ts', line: 42, scope: 'in', verdict: 'confirmed', verification: 'Ran the client against a stub.' })
    expect(t.labels).toEqual(['hitl', 'jreview', 'review:finding', 'severity:high', 'category:correctness', 'scope:in', 'verdict:confirmed'])
    expect(t.description).toContain('**Where:** `src/retry.ts:42`')
    expect(t.description).toContain('**Scope:** in')
    expect(t.description).toContain('**Verdict:** confirmed')
    expect(t.description).toContain(`${BASE}/reviews/run-1`)
    // The rule every dispatch path asks.
    expect(isRecordOnly(t, s.projects[0]!.mode)).toBe(true)
  })

  it('a rerun updates the open ticket instead of filing a duplicate, and files only what is new', () => {
    const s = store()
    const first = fileAgreementFindings(s, s.projects[0]!, review('run-1', 1), [finding('f1', 'Retry loop never backs off')], T1, BASE)
    const key = first.created[0]!

    const second = fileAgreementFindings(
      s,
      s.projects[0]!,
      review('run-2', 2),
      [finding('f1', 'A new race in the cache', { file: 'src/cache.ts', line: 7 }), finding('f2', 'Retry loop never backs off', { line: 48, severity: 'medium', verdict: 'plausible' })],
      T2,
      BASE,
    )

    expect(second.matched).toEqual([key])
    expect(second.created).toHaveLength(1)
    expect(s.tickets).toHaveLength(2)
    expect(second.byFinding.get('f2')).toBe(key)
    const t = s.tickets.find((x) => x.key === key)!
    // The ticket now records the rerun's view of the finding.
    expect(t.finding).toMatchObject({ review: 'run-2', id: 'f2', line: 48, severity: 'medium', verdict: 'plausible' })
    expect(t.labels).toContain('severity:medium')
    expect(t.labels).not.toContain('severity:high')
    expect(t.createdAt).toBe(T1)
    expect(t.updatedAt).toBe(T2)
    expect(t.description).toContain(`${BASE}/reviews/run-2`)
  })

  it('a rerun leaves an earlier run\'s unmatched ticket open, and keeps a posted stamp on a matched one', () => {
    const s = store()
    const r1 = review('run-1', 1)
    const f = [finding('f1', 'Posted and still there'), finding('f2', 'Fixed by the author', { file: 'src/other.ts' })]
    const first = fileAgreementFindings(s, s.projects[0]!, r1, f, T1, BASE)
    f[0]!.ticketKey = first.byFinding.get('f1')
    stampPosted(s, 'run-1', [f[0]!], T1, 'https://github.com/o/r/pull/12#pullrequestreview-1')

    const second = fileAgreementFindings(s, s.projects[0]!, review('run-2', 2), [finding('f1', 'Posted and still there')], T2, BASE)

    expect(second.withdrawn).toEqual([])
    const [posted, stale] = s.tickets
    expect(posted!.finding).toMatchObject({ review: 'run-2', postedAt: T1, postedUrl: 'https://github.com/o/r/pull/12#pullrequestreview-1' })
    expect(posted!.labels).toContain('pr:posted')
    expect(stale).toMatchObject({ status: 'todo', finding: { review: 'run-1' } })
  })

  it('a re-POST of the same review reuses its tickets, closes the dropped ones, and reopens one that comes back', () => {
    const s = store()
    const r = review('run-1', 1)
    const first = fileAgreementFindings(s, s.projects[0]!, r, [finding('f1', 'Kept'), finding('f2', 'Dropped on second thought', { file: 'src/b.ts' })], T1, BASE)
    const dropped = first.byFinding.get('f2')!

    const second = fileAgreementFindings(s, s.projects[0]!, r, [finding('f1', 'Kept')], T2, BASE)
    expect(second.created).toEqual([])
    expect(second.withdrawn).toEqual([dropped])
    const gone = s.tickets.find((t) => t.key === dropped)!
    expect(gone).toMatchObject({ status: 'done', completedAt: T2 })
    expect(gone.resolution).toMatch(/^Withdrawn/)

    const third = fileAgreementFindings(s, s.projects[0]!, r, [finding('f1', 'Kept'), finding('f2', 'Dropped on second thought', { file: 'src/b.ts' })], T2, BASE)
    expect(third.created).toEqual([])
    expect(s.tickets).toHaveLength(2)
    expect(s.tickets.find((t) => t.key === dropped)).toMatchObject({ status: 'todo', completedAt: null, resolution: '' })
  })

  it('honours the ticket the consensus session matched, and never another project\'s', () => {
    const s = store()
    const first = fileAgreementFindings(s, s.projects[0]!, review('run-1', 1), [finding('f1', 'Original wording')], T1, BASE)
    const key = first.created[0]!
    // A finding ticket of some other project is not a candidate.
    s.tickets.push({ ...s.tickets[0]!, id: 'other', key: 'TICK-900', projectId: 'p2' })

    const second = fileAgreementFindings(
      s,
      s.projects[0]!,
      review('run-2', 2),
      [{ ...finding('f1', 'Entirely different words', { file: 'src/moved.ts' }), ticketKey: key }, { ...finding('f2', 'Unrelated', { file: 'src/x.ts' }), ticketKey: 'TICK-900' }],
      T2,
      BASE,
    )
    expect(second.byFinding.get('f1')).toBe(key)
    expect(second.byFinding.get('f2')).not.toBe('TICK-900')
    expect(second.created).toHaveLength(1)
  })

  it('files a check\'s finding (no reviewers) too', () => {
    const s = store()
    fileAgreementFindings(s, s.projects[0]!, review('run-1', 1), [finding('f1', 'The payments suite fails', { reviewers: [], category: 'check', file: undefined, line: undefined })], T1, BASE)
    expect(s.tickets[0]!.description).toContain('a check raised this')
    expect(s.tickets[0]!.description).toContain('not pinned to a file')
  })
})

describe('fileTriageFindings', () => {
  it('files the picked findings as AFK bug tickets on the review\'s project — work, not records', () => {
    const p = project({ mode: 'standard' })
    const s = store(p)
    const byFinding = fileTriageFindings(s, p, { ...review('branch-review', 0), agreement: undefined }, [finding('f1', 'A', { scope: undefined, verdict: undefined })], T1, BASE)
    const t = s.tickets[0]!
    expect(byFinding.get('f1')).toBe(t.key)
    expect(t.labels).toEqual(['afk', 'jreview', 'review:finding', 'severity:high', 'category:correctness'])
    expect(t.acceptanceCriteria).toHaveLength(1)
    expect(t.finding).toMatchObject({ review: 'branch-review', id: 'f1', file: 'src/retry.ts', line: 42 })
    expect(isRecordOnly(t, p.mode)).toBe(false)
  })
})

describe('stampPosted', () => {
  it('stamps posted on the ticket, and gives an older ticket its finding record', () => {
    const s = store()
    const filing = fileAgreementFindings(s, s.projects[0]!, review('run-1', 1), [finding('f1', 'A'), finding('f2', 'B', { file: 'src/b.ts' })], T1, BASE)
    // A ticket filed before tickets kept a finding record.
    const old = s.tickets[1]!
    delete old.finding

    const stamped = stampPosted(
      s,
      'run-1',
      [finding('f1', 'A', { ticketKey: filing.byFinding.get('f1') }), finding('f2', 'B', { file: 'src/b.ts', ticketKey: old.key }), finding('f3', 'No ticket')],
      T2,
      'https://github.com/o/r/pull/12#pullrequestreview-2',
    )

    expect(stamped).toEqual([s.tickets[0]!.key, old.key])
    for (const t of s.tickets) {
      expect(t.finding).toMatchObject({ postedAt: T2, postedUrl: 'https://github.com/o/r/pull/12#pullrequestreview-2' })
      expect(t.labels).toContain('pr:posted')
      expect(t.updatedAt).toBe(T2)
    }
    expect(old.finding).toMatchObject({ review: 'run-1', id: 'f2', file: 'src/b.ts' })
  })
})
