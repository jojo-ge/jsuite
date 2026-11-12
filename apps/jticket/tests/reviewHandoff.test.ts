import { createError } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { Graph, GraphNode } from '../app/utils/graphs'
import { planSendBack, reviewedUpstream, rollupToAttach, SEND_BACK_RULES, SENT_BACK_LABEL, sendBackDraft, type SendBackSource } from '../app/utils/reviewHandoff'
import { sendBackFindings, sendBackPlace } from '../server/utils/reviewHandoff'
import type { Project, Store, Ticket } from '../server/utils/store'

vi.stubGlobal('createError', createError)

// A review node and the build before it in a graph: which build it reviews,
// whether entering it attaches that build's roll-up PR, and Send back — the
// picked findings become dispatchable bugs on the build, once each.

const BASE = 'https://jticket.local'
const TS = '2026-11-12T10:00:00.000Z'

const node = (id: string, mode: string, projectId: string | null): GraphNode => ({
  id, mode, projectId, title: id, note: '', enteredAt: null, enteredNote: '', enteredBriefing: null, stackOn: null,
})
const graph = (nodes: GraphNode[], edges: Array<[string, string]>): Graph => ({
  id: 'g1', key: 'G-1', title: 'Checkout', description: '', repo: '/r', nodes, edges: edges.map(([from, to]) => ({ from, to })), createdAt: TS, updatedAt: TS,
})
const proj = (id: string, key: string, mode: string, integrationBranch = ''): Project =>
  ({ id, key, title: `${key} title`, mode, repo: '/r', integrationBranch, integrationBase: '', share: null, prReview: null }) as unknown as Project

describe('reviewedUpstream', () => {
  const build = proj('pb', 'PROJ-1', 'standard', 'proj/PROJ-1-a')
  const build2 = proj('pc', 'PROJ-2', 'standard', 'proj/PROJ-2-b')
  const review = proj('pr', 'PROJ-3', 'prreview')
  const projects = [build, build2, review]

  it('is the one build directly before the review', () => {
    const g = graph([node('b', 'standard', 'pb'), node('r', 'prreview', 'pr')], [['b', 'r']])
    expect(reviewedUpstream({ graph: g, nodeId: 'r', projects, upstreamMode: 'standard' }).target?.key).toBe('PROJ-1')
  })

  it('has none outside a build — a plan before the review, or a proposed build', () => {
    const plan = graph([node('p', 'plan', 'pb'), node('r', 'prreview', 'pr')], [['p', 'r']])
    expect(reviewedUpstream({ graph: plan, nodeId: 'r', projects, upstreamMode: 'standard' })).toMatchObject({ target: null, candidates: [] })
    const proposed = graph([node('b', 'standard', null), node('r', 'prreview', 'pr')], [['b', 'r']])
    expect(reviewedUpstream({ graph: proposed, nodeId: 'r', projects, upstreamMode: 'standard' }).target).toBeNull()
  })

  it('only looks one step back', () => {
    const g = graph([node('b', 'standard', 'pb'), node('p', 'plan', null), node('r', 'prreview', 'pr')], [['b', 'p'], ['p', 'r']])
    expect(reviewedUpstream({ graph: g, nodeId: 'r', projects, upstreamMode: 'standard' }).candidates).toEqual([])
  })

  it('with two builds, takes the one whose roll-up PR is reviewed, then the latest slice, else asks', () => {
    const fan = graph([node('b', 'standard', 'pb'), node('c', 'standard', 'pc'), node('r', 'prreview', 'pr')], [['b', 'r'], ['c', 'r']])
    const pick = (over: { prHead?: string; prefer?: string } = {}, g = fan) => reviewedUpstream({ graph: g, nodeId: 'r', projects, upstreamMode: 'standard', ...over })
    expect(pick({ prHead: 'proj/PROJ-2-b' }).target?.key).toBe('PROJ-2')
    const ask = pick()
    expect(ask.target).toBeNull()
    expect(ask.candidates.map((p) => p.key)).toEqual(['PROJ-1', 'PROJ-2'])
    expect(ask.why).toMatch(/PROJ-1, PROJ-2/)
    // c stacked on b, both into r: c is the later slice.
    const stacked = graph([node('b', 'standard', 'pb'), node('c', 'standard', 'pc'), node('r', 'prreview', 'pr')], [['b', 'c'], ['b', 'r'], ['c', 'r']])
    expect(pick({}, stacked).target?.key).toBe('PROJ-2')
  })

  it('takes the human\'s pick when it is a candidate, and says so when it is not', () => {
    const fan = graph([node('b', 'standard', 'pb'), node('c', 'standard', 'pc'), node('r', 'prreview', 'pr')], [['b', 'r'], ['c', 'r']])
    expect(reviewedUpstream({ graph: fan, nodeId: 'r', projects, upstreamMode: 'standard', prefer: 'proj-1', prHead: 'proj/PROJ-2-b' }).target?.key).toBe('PROJ-1')
    const bad = reviewedUpstream({ graph: fan, nodeId: 'r', projects, upstreamMode: 'standard', prefer: 'PROJ-3' })
    expect(bad.target).toBeNull()
    expect(bad.why).toMatch(/PROJ-3 is not directly before/)
  })
})

describe('rollupToAttach — entering a proposed Review node', () => {
  const build = { key: 'PROJ-1', integrationBranch: 'proj/PROJ-1-a' }
  it('attaches an open roll-up PR', () => {
    expect(rollupToAttach(build, { state: 'open', number: 12 })).toEqual({ pr: 12, note: '' })
  })
  it('leaves the review unattached, saying why, for anything else', () => {
    expect(rollupToAttach(build, { state: 'merged', number: 12 }).note).toMatch(/#12 is already merged/)
    expect(rollupToAttach(build, { state: 'closed', number: 12 }).note).toMatch(/#12 is closed/)
    expect(rollupToAttach(build, { state: 'none' }).note).toMatch(/no roll-up PR open/)
    expect(rollupToAttach(build, { state: 'unknown' }).note).toMatch(/GitHub couldn't say/)
    expect(rollupToAttach(build, null).note).toMatch(/GitHub couldn't say/)
    expect(rollupToAttach({ ...build, integrationBranch: '' }, null).note).toMatch(/no integration branch yet/)
    for (const s of ['merged', 'closed', 'none', 'unknown'] as const) expect(rollupToAttach(build, { state: s, number: 3 }).pr).toBeNull()
  })
  it('says nothing when no build leads into it, and why when the pick is ambiguous', () => {
    expect(rollupToAttach(null, null)).toEqual({ pr: null, note: '' })
    expect(rollupToAttach(null, null, 'PROJ-1, PROJ-2 all lead into this review').note).toMatch(/No build to review/)
  })
})

const findingTicket = (key: string, over: Partial<SendBackSource> = {}): SendBackSource & Ticket =>
  ({
    id: `id-${key}`,
    key,
    title: `Finding ${key}`,
    description: '**Severity:** high · **Category:** correctness · **Where:** `src/a.ts:4`\n\nIt breaks.\n\n---\nA record, not work: every reviewer raised this. The code is someone else\'s.',
    labels: ['hitl', 'jreview', 'review:finding', 'severity:high', 'category:correctness'],
    finding: { review: 'rv', id: 'f1', severity: 'high', category: 'correctness', file: 'src/a.ts', line: 4 },
    status: 'todo',
    projectId: 'pr',
    owner: '',
    origin: '',
    ...over,
  }) as SendBackSource & Ticket

describe('planSendBack', () => {
  it('sends findings, skips ones already sent, refuses the rest, once per key', () => {
    const tickets = [
      findingTicket('TICK-1'),
      findingTicket('TICK-2', { sentBack: { ticketId: 'fix-2', ticketKey: 'TICK-9', projectId: 'pb', at: TS } }),
      findingTicket('TICK-3', { sentBack: { ticketId: 'gone', ticketKey: 'TICK-8', projectId: 'pb', at: TS } }),
      findingTicket('TICK-4', { labels: ['hitl'], finding: undefined }),
    ]
    const plan = planSendBack({ keys: ['TICK-1', 'tick-1', 'TICK-2', 'TICK-3', 'TICK-4', 'TICK-77'], tickets, ticketExists: (id) => id === 'fix-2', projectKey: 'PROJ-3' })
    expect(plan.send.map((t) => t.key)).toEqual(['TICK-1', 'TICK-3'])
    expect(plan.already).toEqual([{ key: 'TICK-2', ticketKey: 'TICK-9' }])
    expect(plan.refused.map((r) => r.key)).toEqual(['TICK-4', 'TICK-77'])
  })

  it('treats a hand-labelled finding (no record) as a finding', () => {
    const plan = planSendBack({ keys: ['TICK-5'], tickets: [findingTicket('TICK-5', { finding: undefined })], ticketExists: () => false, projectKey: 'PROJ-3' })
    expect(plan.send).toHaveLength(1)
  })
})

describe('sendBackDraft', () => {
  const ctx = { rule: SEND_BACK_RULES.prreview!, review: { key: 'PROJ-3', title: 'PR #12 · A' }, base: BASE }
  it('carries the title, the description without the record-only footer, and a link back', () => {
    const d = sendBackDraft(findingTicket('TICK-1'), ctx)
    expect(d.title).toBe('Finding TICK-1')
    expect(d.type).toBe('bug')
    expect(d.labels).toEqual(['afk', SENT_BACK_LABEL, 'severity:high', 'category:correctness'])
    expect(d.description).toContain('`src/a.ts:4`')
    expect(d.description).toContain('It breaks.')
    expect(d.description).not.toMatch(/A record, not work/)
    expect(d.description).toContain(`[TICK-1](${BASE}/tickets/TICK-1)`)
    expect(d.description).toContain(`${BASE}/projects/PROJ-3?tab=review`)
    expect(d.acceptanceCriteria.length).toBe(1)
  })
  it('puts the location in front when the description does not name it', () => {
    const d = sendBackDraft(findingTicket('TICK-1', { description: 'Just words.' }), ctx)
    expect(d.description.startsWith('**Where:** `src/a.ts:4`')).toBe(true)
  })
  it('takes its type and agency from the rule — a plan review sends decisions', () => {
    const rule = { ...SEND_BACK_RULES.prreview!, upstreamMode: 'plan', type: 'decision', agency: 'hitl' as const }
    const d = sendBackDraft(findingTicket('TICK-1'), { ...ctx, rule })
    expect(d.type).toBe('decision')
    expect(d.labels[0]).toBe('hitl')
  })
})

describe('sendBackFindings on a store', () => {
  const setup = (withGraph = true) => {
    const build = proj('pb', 'PROJ-1', 'standard', 'proj/PROJ-1-a')
    const review = proj('pr', 'PROJ-3', 'prreview')
    const g = graph([node('b', 'standard', 'pb'), node('r', 'prreview', 'pr')], [['b', 'r']])
    return {
      projects: [build, review],
      tickets: [findingTicket('TICK-1'), findingTicket('TICK-2')],
      docs: [],
      prs: [],
      graphs: withGraph ? [g] : [],
      counters: { project: 3, ticket: 10, doc: 0, pr: 0, graph: 1 },
    } as unknown as Store
  }

  it('files one AFK bug per finding on the build and records it on the finding', () => {
    const store = setup()
    const res = sendBackFindings(store, 'PROJ-3', { ticketKeys: ['TICK-1', 'TICK-2'] }, TS, BASE)
    expect(res.target.key).toBe('PROJ-1')
    expect(res.sent.map((s) => s.key)).toEqual(['TICK-1', 'TICK-2'])
    const fixes = store.tickets.filter((t) => t.projectId === 'pb')
    expect(fixes).toHaveLength(2)
    expect(fixes[0]).toMatchObject({ type: 'bug', status: 'todo', title: 'Finding TICK-1' })
    expect(fixes[0]!.labels).toContain('afk')
    expect(fixes[0]!.labels).not.toContain('review:finding')
    expect(fixes[0]!.finding).toBeUndefined()
    const f1 = store.tickets.find((t) => t.key === 'TICK-1')!
    expect(f1.sentBack).toEqual({ ticketId: fixes[0]!.id, ticketKey: fixes[0]!.key, projectId: 'pb', at: TS })
  })

  it('is idempotent: sending again files nothing', () => {
    const store = setup()
    sendBackFindings(store, 'PROJ-3', { ticketKeys: ['TICK-1'] }, TS, BASE)
    const again = sendBackFindings(store, 'PROJ-3', { ticketKeys: ['TICK-1'] }, TS, BASE)
    expect(again.sent).toEqual([])
    expect(again.already).toHaveLength(1)
    expect(store.tickets.filter((t) => t.projectId === 'pb')).toHaveLength(1)
  })

  it('is refused outside a graph, and not offered there', () => {
    const store = setup(false)
    expect(() => sendBackFindings(store, 'PROJ-3', { ticketKeys: ['TICK-1'] }, TS, BASE)).toThrow(/not in a graph/)
    expect(sendBackPlace(store, store.projects[1]!).offered).toBe(false)
    expect(sendBackPlace(store, store.projects[0]!).why).toMatch(/only a review sends findings back/)
  })

  it('refuses an empty pick', () => {
    expect(() => sendBackFindings(setup(), 'PROJ-3', { ticketKeys: [] }, TS, BASE)).toThrow(/ticketKeys/)
  })
})
