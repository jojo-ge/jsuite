import { describe, expect, it } from 'vitest'
import {
  findingLabels,
  findingRecord,
  findingsForTickets,
  isFindingTicket,
  isRecordOnly,
  planFindingTickets,
  recordOnlyError,
  reviewProjectKey,
  reviewProjectProblem,
  titleSimilarity,
  type FindingTicketRef,
} from '../app/utils/reviewFindings'
import type { Finding } from '../app/utils/reviewTypes'

// Every review belongs to a project and its findings are always tickets
// (TICK-944). These are the rules; server/utils/reviewTickets.ts applies them
// to the store (tests/reviewTickets.test.ts).

const finding = (id: string, title: string, over: Partial<Finding> = {}): Finding => ({
  id,
  title,
  severity: 'high',
  category: 'correctness',
  summary: 'One sentence.',
  detail: 'Detail.',
  reviewers: [1, 2],
  ...over,
})

const ticket = (key: string, title: string, over: Partial<FindingTicketRef> & { review?: string; file?: string; category?: string } = {}): FindingTicketRef => ({
  key,
  title,
  status: over.status ?? 'todo',
  finding: over.finding ?? { review: over.review ?? 'run-1', id: 'f1', severity: 'high', category: over.category ?? 'correctness', ...(over.file ? { file: over.file } : {}) },
})

describe('a review needs a project', () => {
  const exists = (key: string) => key === 'PROJ-7'

  it('refuses a review with no project', () => {
    expect(reviewProjectProblem({}, exists)).toMatch(/belongs to a jTicket project/)
    expect(reviewProjectProblem({ project: '  ' }, exists)).toMatch(/belongs to a jTicket project/)
    expect(reviewProjectProblem({ consensus: null }, exists)).toMatch(/belongs to a jTicket project/)
  })

  it('refuses a project that does not exist', () => {
    expect(reviewProjectProblem({ project: 'PROJ-99' }, exists)).toMatch(/PROJ-99 not found/)
    expect(reviewProjectProblem({ consensus: { projectKey: 'PROJ-99' } }, exists)).toMatch(/PROJ-99 not found/)
  })

  it('accepts a project review and a consensus review of an existing project', () => {
    expect(reviewProjectProblem({ project: 'PROJ-7' }, exists)).toBe('')
    expect(reviewProjectProblem({ consensus: { projectKey: 'PROJ-7' } }, exists)).toBe('')
  })

  it('names the project a review belongs to', () => {
    expect(reviewProjectKey({ project: 'PROJ-7' })).toBe('PROJ-7')
    expect(reviewProjectKey({ consensus: { projectKey: 'PROJ-8' } })).toBe('PROJ-8')
    expect(reviewProjectKey({})).toBe('')
  })
})

describe('the record-only dispatch rule', () => {
  const findingTicket = { key: 'TICK-9', labels: ['hitl', 'jreview', 'review:finding'] }
  const note = { key: 'TICK-3', labels: ['afk'] }

  it('makes a finding ticket in a PR review project record-only', () => {
    expect(isRecordOnly(findingTicket, 'prreview')).toBe(true)
    expect(isRecordOnly({ labels: ['hitl'], finding: { review: 'r', id: 'f1' } }, 'prreview')).toBe(true)
  })

  it('makes a ticket added by hand to a PR review project record-only too', () => {
    // The pull request is someone else's: nothing on its project is work.
    expect(isRecordOnly(note, 'prreview')).toBe(true)
  })

  it('leaves a finding ticket in any other project as work', () => {
    // A triage or consensus review's finding is a bug an agent fixes.
    expect(isRecordOnly(findingTicket, 'standard')).toBe(false)
    expect(isRecordOnly(findingTicket, undefined)).toBe(false)
  })

  it('says why a dispatch is refused, and nothing when it is not', () => {
    expect(recordOnlyError(findingTicket, { key: 'PROJ-7', mode: 'prreview' })).toMatch(/TICK-9 is a review finding on PROJ-7.*never dispatched/)
    expect(recordOnlyError(note, { key: 'PROJ-7', mode: 'prreview' })).toMatch(/TICK-3 is a note on PROJ-7, a PR review project.*never dispatched/)
    expect(recordOnlyError(note, { key: 'PROJ-2', mode: 'standard' })).toBe('')
    expect(recordOnlyError(findingTicket, { key: 'PROJ-2', mode: 'standard' })).toBe('')
    expect(recordOnlyError(findingTicket, null)).toBe('')
  })

  it('recognises a finding ticket by its record or its label', () => {
    expect(isFindingTicket({ labels: ['afk', 'review:finding'] })).toBe(true)
    expect(isFindingTicket({ labels: [], finding: {} })).toBe(true)
    expect(isFindingTicket({ labels: ['afk'] })).toBe(false)
  })
})

describe('finding → ticket matching', () => {
  it('files a new ticket for every finding when the project has none', () => {
    const plan = planFindingTickets({ reviewKey: 'run-1', findings: [finding('f1', 'A'), finding('f2', 'B')], tickets: [] })
    expect(plan.create).toEqual(['f1', 'f2'])
    expect(plan.link.size).toBe(0)
    expect(plan.withdraw).toEqual([])
  })

  it('a rerun matches an open finding ticket by title rather than filing a duplicate', () => {
    const plan = planFindingTickets({
      reviewKey: 'run-2',
      findings: [finding('f1', 'retry loop never backs off after a 429.'), finding('f2', 'A brand new problem')],
      tickets: [ticket('TICK-41', 'Retry loop never backs off after a 429')],
    })
    expect([...plan.link]).toEqual([['f1', 'TICK-41']])
    expect(plan.create).toEqual(['f2'])
  })

  it('matches a reworded title on the same file', () => {
    const plan = planFindingTickets({
      reviewKey: 'run-2',
      findings: [finding('f1', 'Retry loop does not back off after a 429 response', { file: 'src/retry.ts', line: 61 })],
      tickets: [ticket('TICK-41', 'Retry loop never backs off after a 429', { file: 'src/retry.ts' })],
    })
    expect(plan.link.get('f1')).toBe('TICK-41')
    expect(plan.create).toEqual([])
  })

  it('does not match a reworded title on another file, in another category, or an unrelated one on the same file', () => {
    const tickets = [ticket('TICK-41', 'Retry loop never backs off after a 429', { file: 'src/retry.ts' })]
    const reworded = 'Retry loop does not back off after a 429 response'
    expect(planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', reworded, { file: 'src/other.ts' })], tickets }).create).toEqual(['f1'])
    expect(planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', reworded, { file: 'src/retry.ts', category: 'performance' })], tickets }).create).toEqual(['f1'])
    expect(planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', 'Timeout is read from the wrong env var', { file: 'src/retry.ts' })], tickets }).create).toEqual(['f1'])
  })

  it('treats the same title on two files as two findings, but matches one pinned to no file', () => {
    const tickets = [ticket('TICK-41', 'Missing null check', { file: 'a.ts' })]
    expect(planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', 'Missing null check', { file: 'b.ts' })], tickets }).create).toEqual(['f1'])
    expect(planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', 'Missing null check')], tickets }).link.get('f1')).toBe('TICK-41')
  })

  it('gives a reworded ticket to the closest finding, whatever order they arrive in', () => {
    const tickets = [ticket('TICK-41', 'Missing null check on the user record', { file: 'a.ts' })]
    const plan = planFindingTickets({
      reviewKey: 'run-2',
      findings: [finding('f1', 'Missing null check on the order', { file: 'a.ts' }), finding('f2', 'Missing null check on the user record object', { file: 'a.ts' })],
      tickets,
    })
    expect(plan.link.get('f2')).toBe('TICK-41')
    expect(plan.create).toEqual(['f1'])
  })

  it('takes the ticket the consensus session named, when it is an open finding ticket', () => {
    const tickets = [ticket('TICK-41', 'Old wording entirely'), ticket('TICK-42', 'Something else')]
    const plan = planFindingTickets({ reviewKey: 'run-2', findings: [{ ...finding('f1', 'Completely new words'), ticketKey: 'TICK-41' }], tickets })
    expect(plan.link.get('f1')).toBe('TICK-41')
  })

  it('ignores a named ticket that is not an open finding ticket of the project', () => {
    const tickets = [ticket('TICK-41', 'Closed one', { status: 'done' })]
    const plan = planFindingTickets({ reviewKey: 'run-2', findings: [{ ...finding('f1', 'New'), ticketKey: 'TICK-41' }, { ...finding('f2', 'Other'), ticketKey: 'TICK-999' }], tickets })
    expect(plan.create).toEqual(['f1', 'f2'])
  })

  it('never matches a finished ticket of an earlier run — a closed finding raised again is a new ticket', () => {
    const plan = planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', 'Same title')], tickets: [ticket('TICK-41', 'Same title', { status: 'done' })] })
    expect(plan.create).toEqual(['f1'])
  })

  it('gives each ticket to one finding, and an exact title beats a looser match made earlier in the list', () => {
    const tickets = [ticket('TICK-41', 'Cache key ignores the tenant id', { file: 'src/cache.ts' })]
    const plan = planFindingTickets({
      reviewKey: 'run-2',
      findings: [
        finding('f1', 'Cache key ignores the tenant id and locale', { file: 'src/cache.ts' }),
        finding('f2', 'Cache key ignores the tenant id', { file: 'src/cache.ts' }),
      ],
      tickets,
    })
    expect(plan.link.get('f2')).toBe('TICK-41')
    expect(plan.create).toEqual(['f1'])
  })

  it('takes the same-file ticket among identical titles', () => {
    const tickets = [ticket('TICK-41', 'Missing null check', { file: 'a.ts' }), ticket('TICK-42', 'Missing null check', { file: 'b.ts' })]
    const plan = planFindingTickets({ reviewKey: 'run-2', findings: [finding('f1', 'Missing null check', { file: 'b.ts' })], tickets })
    expect(plan.link.get('f1')).toBe('TICK-42')
  })

  it('a re-POST of the same review reuses its tickets and withdraws the ones it dropped', () => {
    const tickets = [ticket('TICK-41', 'Kept', { review: 'run-1' }), ticket('TICK-42', 'Dropped', { review: 'run-1' }), ticket('TICK-40', 'From an earlier run', { review: 'run-0' })]
    const plan = planFindingTickets({ reviewKey: 'run-1', findings: [finding('f1', 'Kept')], tickets })
    expect(plan.link.get('f1')).toBe('TICK-41')
    expect(plan.create).toEqual([])
    // Only what THIS review filed is withdrawn — an earlier run's open ticket is left alone.
    expect(plan.withdraw).toEqual(['TICK-42'])
  })

  it('a re-POST reuses its own ticket even after it was closed', () => {
    const plan = planFindingTickets({ reviewKey: 'run-1', findings: [finding('f1', 'Back again')], tickets: [ticket('TICK-41', 'Back again', { review: 'run-1', status: 'done' })] })
    expect(plan.link.get('f1')).toBe('TICK-41')
    expect(plan.withdraw).toEqual([])
  })

  it('scores title overlap between 0 and 1', () => {
    expect(titleSimilarity('Retry loop never backs off', 'retry LOOP never backs off!')).toBe(1)
    expect(titleSimilarity('alpha beta', 'gamma delta')).toBe(0)
    expect(titleSimilarity('', 'x')).toBe(0)
  })
})

describe('what a finding ticket carries', () => {
  const f = finding('f2', 'Retry loop never backs off', { file: 'src/retry.ts', line: 42, scope: 'in', verdict: 'confirmed', verification: 'Ran it: four requests in 40ms.' })

  it('records the scope, verdict, file and line', () => {
    expect(findingRecord('run-1', f)).toEqual({
      review: 'run-1',
      id: 'f2',
      severity: 'high',
      category: 'correctness',
      file: 'src/retry.ts',
      line: 42,
      scope: 'in',
      verdict: 'confirmed',
      verification: 'Ran it: four requests in 40ms.',
    })
  })

  it('keeps the posted stamp across a rerun, and drops a withdrawal', () => {
    const was = { ...findingRecord('run-1', f), postedAt: '2026-11-10T10:00:00.000Z', postedUrl: 'https://github.com/o/r/pull/1#pullrequestreview-9', withdrawnAt: '2026-11-10T11:00:00.000Z' }
    const next = findingRecord('run-2', { ...f, id: 'f1', line: 48 }, was)
    expect(next).toMatchObject({ review: 'run-2', id: 'f1', line: 48, postedAt: was.postedAt, postedUrl: was.postedUrl })
    expect(next.withdrawnAt).toBeUndefined()
  })

  it('labels a record-only ticket HITL with its scope and verdict, a triage ticket AFK without', () => {
    expect(findingLabels(f, { recordOnly: true })).toEqual(['hitl', 'jreview', 'review:finding', 'severity:high', 'category:correctness', 'scope:in', 'verdict:confirmed'])
    expect(findingLabels(f, { recordOnly: false })).toEqual(['afk', 'jreview', 'review:finding', 'severity:high', 'category:correctness'])
  })

  it('replaces the labels a finding owns and keeps the rest', () => {
    const labels = findingLabels({ ...f, severity: 'low', verdict: 'plausible' }, { recordOnly: true, keep: ['afk', 'jreview', 'review:finding', 'severity:high', 'verdict:confirmed', 'pr:posted', 'mine'] })
    expect(labels).toEqual(['hitl', 'jreview', 'review:finding', 'severity:low', 'category:correctness', 'scope:in', 'verdict:plausible', 'pr:posted', 'mine'])
  })
})

describe('Post to PR picks finding tickets', () => {
  const review = { findings: [finding('f1', 'A', { ticketKey: 'TICK-41' }), finding('f2', 'B', { ticketKey: 'TICK-42' }), finding('f3', 'Not a ticket yet')] }

  it('resolves the picked tickets to their findings, in the review order', () => {
    const { findings, missing } = findingsForTickets(review, ['TICK-42', 'TICK-41'])
    expect(findings.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(missing).toEqual([])
  })

  it('reports picks that are not finding tickets of this review', () => {
    expect(findingsForTickets(review, ['TICK-41', 'TICK-7']).missing).toEqual(['TICK-7'])
  })

  it('posts nothing for no picks — the summary alone', () => {
    expect(findingsForTickets(review, [])).toEqual({ findings: [], missing: [] })
  })
})
