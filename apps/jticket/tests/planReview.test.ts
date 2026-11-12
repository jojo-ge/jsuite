import { createError } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { assembleBriefing, type Graph, type GraphNode, type ProjectFacts } from '../app/utils/graphs'
import {
  coercePlanReview,
  planReviewDescription,
  planReviewDone,
  planReviewerPrompt,
  planReviewNeedsPlan,
  planReviewStartProblem,
  planReviewVerdict,
  type PlanUnderReview,
} from '../app/utils/planReview'
import { isReviewProject, reviewNeedsPr, settleRun } from '../app/utils/prReview'
import { projectTypeLabel } from '../app/utils/projectType'
import { isRecordOnly, recordOnlyError } from '../app/utils/reviewFindings'
import { SEND_BACK_RULES, sendBackDraft } from '../app/utils/reviewHandoff'
import { isPlanReview, reviewTargetLabel, type Finding, type Review } from '../app/utils/reviewTypes'
import { attachPlanToReview, createPlanReviewProject, planFactOf, planUnderReview } from '../server/utils/planReview'
import { reviewerPrompt, triagePrompt } from '../server/utils/reviewHerdr'
import { sendBackFindings, sendBackPlace } from '../server/utils/reviewHandoff'
import { agreementTicketDescription } from '../server/utils/reviewTickets'
import type { Project, Store, Ticket } from '../server/utils/store'

vi.stubGlobal('createError', createError)

// A plan review project reviews one plan project's spec and ticket plan
// before its builds run: the review engine's agreement review with the
// subject set to the plan — no diff — whose findings are record-only tickets
// that Send back turns into decision tickets on the plan.

const TS = '2026-11-12T10:00:00.000Z'
const BASE = 'https://jticket.local'

const proj = (id: string, key: string, mode: string, extra: Partial<Project> = {}): Project =>
  ({ id, key, title: `${key} title`, description: '', mode, repo: '/r', integrationBranch: '', integrationBase: '', share: null, prompts: {}, createdAt: TS, updatedAt: TS, ...extra }) as unknown as Project
const ticket = (id: string, key: string, projectId: string, extra: Partial<Ticket> = {}): Ticket =>
  ({ id, key, title: `${key} title`, description: '', acceptanceCriteria: [], type: 'task', status: 'todo', projectId, labels: [], blockedBy: [], comments: [], createdAt: TS, updatedAt: TS, ...extra }) as unknown as Ticket
const store = (projects: Project[], tickets: Ticket[] = [], extra: Partial<Store> = {}): Store =>
  ({ projects, tickets, docs: [], graphs: [], prs: [], counters: { project: 10, ticket: 50, doc: 5, pr: 0, graph: 2 }, repos: [], ...extra }) as unknown as Store
const node = (id: string, mode: string, projectId: string | null, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, mode, projectId, title: id, note: '', enteredAt: null, enteredNote: '', enteredBriefing: null, stackOn: null, ...extra,
})
const graph = (nodes: GraphNode[], edges: Array<[string, string]>): Graph => ({
  id: 'g1', key: 'G-1', title: 'G', description: '', repo: '/r', nodes, edges: edges.map(([from, to]) => ({ from, to })), createdAt: TS, updatedAt: TS,
})

const plan: PlanUnderReview = { key: 'PROJ-1', title: 'Cart', mode: 'plan', repo: '/r', drafts: 3, builds: 2, docs: 1, drafting: false }
const reviewProject = (planProjectId = 'pp', runs: any[] = []) => ({ key: 'PROJ-2', mode: 'planreview', share: null, planReview: { planProjectId, runs } })

describe('the plan review record', () => {
  it('coerces what is stored, and reads its state', () => {
    const r = coercePlanReview({ planProjectId: 'pp', runs: [{ n: 1, status: 'done', reviewKey: 'k1', verdict: 'approve', drafts: 3 }, { reviewKey: '' }, { n: 2, status: 'paused', reviewKey: 'k2' }] })!
    expect(r.runs.map((x) => [x.n, x.status, x.drafts, x.builds])).toEqual([[1, 'done', 3, 0], [2, 'stopped', 0, 0]])
    expect(planReviewVerdict(r)).toBe('approve')
    expect(planReviewDone(r)).toBe(false)
    expect(coercePlanReview(null)).toBeNull()
    expect(coercePlanReview({})).toEqual({ planProjectId: '', runs: [] })
  })

  it('settles a plan review run like a PR review run', () => {
    const runs = coercePlanReview({ planProjectId: 'pp', runs: [{ n: 1, status: 'running', reviewKey: 'k1', startedAt: TS }] })!.runs
    const done = settleRun(runs, 'k1', 'done', 'later', 'request-changes')
    expect(done[0]).toMatchObject({ status: 'done', verdict: 'request-changes', endedAt: 'later', drafts: 0 })
    expect(settleRun(done, 'k1', 'stopped', 'x')).toBe(done)
  })

  it('is a review project — off the boards, on the Reviews board — but never waits on a PR', () => {
    const p = { mode: 'planreview', prReview: null }
    expect(isReviewProject(p)).toBe(true)
    expect(reviewNeedsPr(p)).toBe(false)
    expect(planReviewNeedsPlan({ mode: 'planreview', planReview: { planProjectId: '', runs: [] } })).toBe(true)
    expect(projectTypeLabel('planreview')).toBe('Plan review')
  })

  it('keeps every ticket on it a record', () => {
    const finding = { key: 'TICK-9', labels: ['review:finding'], finding: { review: 'k', id: 'f1', severity: 'high' as const, category: 'slicing' } }
    expect(isRecordOnly(finding, 'planreview')).toBe(true)
    expect(isRecordOnly({ key: 'TICK-8', labels: [] }, 'planreview')).toBe(true)
    expect(recordOnlyError(finding, { key: 'PROJ-2', mode: 'planreview' })).toMatch(/found in the plan.*decision ticket/)
  })
})

describe('the start decision', () => {
  it('starts a plan with a ticket plan', () => {
    expect(planReviewStartProblem({ project: reviewProject(), plan })).toBeNull()
    expect(planReviewStartProblem({ project: reviewProject(), plan: { ...plan, drafts: 0, builds: 0 } })).toBeNull() // its docs are still something to read
  })

  it('refuses what has nothing to review, or no one to review it', () => {
    const msg = (input: Parameters<typeof planReviewStartProblem>[0]) => planReviewStartProblem(input)?.message ?? ''
    expect(msg({ project: { ...reviewProject(), mode: 'prreview' }, plan })).toMatch(/not a plan review project/)
    expect(msg({ project: reviewProject(''), plan: null })).toMatch(/no plan to review yet/)
    expect(msg({ project: reviewProject(), plan: null })).toMatch(/is gone/)
    expect(msg({ project: reviewProject(), plan: { ...plan, mode: 'standard' } })).toMatch(/not a plan project/)
    expect(msg({ project: reviewProject(), plan: { ...plan, repo: '' } })).toMatch(/no repo/)
    expect(msg({ project: reviewProject(), plan: { ...plan, drafting: true } })).toMatch(/still drafting/)
    expect(msg({ project: reviewProject(), plan: { ...plan, drafts: 0, builds: 0, docs: 0 } })).toMatch(/no ticket plan and no docs/)
    expect(planReviewStartProblem({ project: reviewProject(), plan, reviewers: 1 })).toMatchObject({ status: 400 })
    expect(msg({ project: { ...reviewProject(), share: { side: 'joiner' } }, plan })).toMatch(/shared with you/)
  })
})

const planReview = (extra: Partial<Review> = {}): Review =>
  ({
    format: 'j-review', version: 1, key: 'plan-cart', title: 'PROJ-2 · plan PROJ-1 · review 1', repoPath: '/r', branch: '', base: '', pr: null,
    subject: { kind: 'plan', projectKey: 'PROJ-1', title: 'Cart\nplan' }, workdir: '/r', worktree: false, status: 'reviewing',
    reviewers: [{ n: 1, docKey: 'jreview-plan-cart-r1', status: 'queued' }, { n: 2, docKey: 'jreview-plan-cart-r2', status: 'queued' }],
    triage: { docKey: 'jreview-plan-cart-triage', status: 'waiting' }, findings: [], tickets: null, agreement: { loop: 1 }, verify: true, project: 'PROJ-2',
    createdAt: TS, updatedAt: TS, ...extra,
  }) as Review

describe('the reviewer and consensus prompts', () => {
  it('hands a reviewer the plan, not a diff, on one line starting with /jplan-review', () => {
    const p = planReviewerPrompt(planReview(), 2, '/suite/jreview-report/SKILL.md')
    expect(p.startsWith('/jplan-review PROJ-1 ')).toBe(true)
    expect(p).not.toMatch(/\n/)
    expect(p).toContain('GET http://localhost:43000/api/projects/PROJ-1/ticket-plan')
    expect(p).toContain('labelled spec')
    expect(p).toMatch(/read-only/)
    expect(p).not.toMatch(/git diff|fixed point/)
    expect(p).toContain('read /suite/jreview-report/SKILL.md and follow it with review=plan-cart reviewer=2 doc=jreview-plan-cart-r2')
    expect(p).toMatch(/APPROVAL line/)
  })

  it('is what the engine dispatches for a plan review, and the consensus session is the usual one', () => {
    const p = reviewerPrompt(planReview(), 1)
    expect(p.startsWith('/jplan-review PROJ-1 ')).toBe(true)
    expect(p).toMatch(/apps\/jticket\/\.claude\/skills\/jreview-report\/SKILL\.md/)
    expect(triagePrompt(planReview())).toBe('/jreview-consensus plan-cart')
    // A diff review is untouched.
    const diff = reviewerPrompt(planReview({ subject: undefined, branch: 'jreview/pr-3', base: 'origin/main' }), 1)
    expect(diff.startsWith('/code-review')).toBe(true)
  })

  it('labels a plan review by its plan', () => {
    expect(isPlanReview(planReview())).toBe(true)
    expect(reviewTargetLabel(planReview())).toBe('plan PROJ-1')
    expect(reviewTargetLabel({ base: 'origin/main', branch: 'b' })).toBe('origin/main...b')
  })
})

describe('the finding tickets and Send back', () => {
  const f: Finding = { id: 'f1', title: 'Build "Cart UI" needs the session store from "Auth API"', severity: 'high', category: 'ordering', summary: 'S.', detail: 'D.', reviewers: [1, 2], verdict: 'confirmed' }

  it('describes a plan finding as a record of the plan, without a file it has none of', () => {
    const d = agreementTicketDescription(planReview(), f, BASE)
    expect(d).not.toMatch(/Where:|PR #|pull request/)
    expect(d).toMatch(/A record, not work: every reviewer \(1, 2\) raised this in the plan review/)
    expect(d).toContain(`[PROJ-1](${BASE}/projects/PROJ-1)`)
    // Send back strips the record footer, as it does a PR finding's.
    const draft = sendBackDraft(
      { id: 't', key: 'TICK-9', title: f.title, description: d, labels: [], finding: { review: 'plan-cart', id: 'f1', severity: 'high', category: 'ordering' } },
      { rule: SEND_BACK_RULES.planreview!, review: { key: 'PROJ-2', title: 'Plan review' }, base: BASE },
    )
    expect(draft.description).not.toMatch(/A record, not work/)
    expect(draft).toMatchObject({ type: 'decision', labels: ['hitl', 'review:sent-back', 'severity:high', 'category:ordering'] })
  })

  it('sends picked findings back to the plan it reviews as HITL decision tickets — in a graph or not', () => {
    const planP = proj('pp', 'PROJ-1', 'plan')
    const rev = proj('pr', 'PROJ-2', 'planreview', { planReview: { planProjectId: 'pp', runs: [] } })
    const finding = ticket('t9', 'TICK-9', 'pr', { labels: ['hitl', 'review:finding'], finding: { review: 'k', id: 'f1', severity: 'high', category: 'ordering' } as any })
    const s = store([planP, rev], [finding])
    expect(sendBackPlace(s, rev)).toMatchObject({ offered: true, graph: null, target: { key: 'PROJ-1' }, ticketType: 'decision' })
    const res = sendBackFindings(s, 'PROJ-2', { ticketKeys: ['TICK-9'] }, TS, BASE)
    expect(res.sent).toHaveLength(1)
    const made = s.tickets.find((t) => t.key === res.sent[0]!.ticketKey)!
    expect(made).toMatchObject({ projectId: 'pp', type: 'decision' })
    expect(made.labels).toContain('hitl')
    expect(finding.sentBack?.ticketKey).toBe(made.key)
    // No plan picked yet: not offered.
    rev.planReview = { planProjectId: '', runs: [] }
    expect(sendBackPlace(s, rev)).toMatchObject({ offered: false })
  })
})

describe('making and pointing a plan review project', () => {
  it('is made in its plan\'s codebase, pointed at it, and can be re-pointed until it has reviewed a live plan', () => {
    const planP = proj('pp', 'PROJ-1', 'plan', { repo: '/code/shop' })
    const other = proj('po', 'PROJ-3', 'plan')
    const s = store([planP, other])
    const made = createPlanReviewProject(s, { plan: planP })
    expect(made).toMatchObject({ mode: 'planreview', repo: '/code/shop', title: 'Plan review · PROJ-1 PROJ-1 title', planReview: { planProjectId: 'pp', runs: [] } })
    expect(made.description).toContain('[PROJ-1 — PROJ-1 title](/projects/PROJ-1)')

    const loose = createPlanReviewProject(s, { plan: null, repo: '/r', note: 'Large plan.' })
    expect(loose.planReview!.planProjectId).toBe('')
    expect(loose.description.startsWith('Large plan.')).toBe(true)
    attachPlanToReview(s, loose.key, 'PROJ-3')
    expect(loose.planReview!.planProjectId).toBe('po')
    expect(loose.title).toBe('Plan review · PROJ-3 PROJ-3 title')
    expect(() => attachPlanToReview(s, loose.key, made.key)).toThrow(/not a plan project/)

    loose.planReview!.runs = coercePlanReview({ runs: [{ reviewKey: 'k', status: 'done' }] })!.runs
    expect(() => attachPlanToReview(s, loose.key, 'PROJ-1')).toThrow(/already reviewed another plan/)
  })

  it('reads the plan: its drafts, builds and spec, drafts left out of its tickets', () => {
    const planP = proj('pp', 'PROJ-1', 'plan')
    const g = graph([node('n0', 'plan', 'pp'), node('b1', 'standard', null), node('b2', 'standard', null)], [['n0', 'b1'], ['b1', 'b2']])
    const s = store([planP], [ticket('d1', 'TICK-1', 'pp', { plannedFor: 'b1' }), ticket('d2', 'TICK-2', 'pp', { plannedFor: 'b2' }), ticket('q', 'TICK-3', 'pp')], {
      graphs: [g],
      docs: [{ id: 'x', key: 'DOC-4', title: 'Spec', documentKey: 'k', projectId: 'pp', labels: ['spec'], status: 'draft', createdAt: TS, updatedAt: TS }] as any,
    })
    expect(planFactOf(s, planP)).toEqual({ drafts: 2, builds: 2, proposedBuilds: 2, specDoc: 'DOC-4', drafting: false })
    const rev = createPlanReviewProject(s, { plan: planP })
    expect(planUnderReview(s, rev)).toMatchObject({ key: 'PROJ-1', drafts: 2, builds: 2, docs: 1 })
  })
})

const facts = (id: string, key: string, mode: string, extra: Partial<ProjectFacts> = {}): ProjectFacts => ({
  id, key, title: `T${key}`, mode,
  tickets: { total: 2, done: 2, open: 0, inProgress: [], hitlOpen: [] },
  auto: false, integrationBranch: '', integrationBase: '', outcomeDoc: null, review: null, blockedOutside: [],
  rollup: { state: 'no-branch', ci: 'none' }, branch: { known: false }, slice: { state: 'none', reason: 'x' },
  ...extra,
})
const messages = (b: { flags: Array<{ message: string }> }) => b.flags.map((f) => f.message)

describe('the briefing around a plan review', () => {
  const g = graph([node('p', 'plan', 'pp', { enteredAt: 't' }), node('pr', 'planreview', 'prv', { enteredAt: 't' }), node('b', 'standard', null)], [['p', 'pr'], ['pr', 'b']])

  it('before a plan review: the ticket plan, its builds and the spec', () => {
    const ok = assembleBriefing({ graph: g, nodeId: 'pr', facts: new Map([['pp', facts('pp', 'PROJ-1', 'plan', { plan: { drafts: 5, builds: 2, proposedBuilds: 2, specDoc: 'DOC-4', drafting: false } })]]), at: 'now' })
    expect(messages(ok)).toEqual(expect.arrayContaining(["PROJ-1 TPROJ-1's ticket plan: 5 drafts across 2 builds (2 still proposed).", "PROJ-1 TPROJ-1's spec is DOC-4."]))
    expect(ok.flags.filter((f) => f.level === 'warning')).toEqual([])

    const bare = assembleBriefing({ graph: g, nodeId: 'pr', facts: new Map([['pp', facts('pp', 'PROJ-1', 'plan', { plan: { drafts: 0, builds: 0, proposedBuilds: 0, specDoc: null, drafting: true } })]]), at: 'now' })
    const warned = bare.flags.filter((f) => f.level === 'warning').map((f) => f.message).join('\n')
    expect(warned).toMatch(/no ticket plan yet/)
    expect(warned).toMatch(/no spec doc/)
    expect(warned).toMatch(/still drafting/)
  })

  it("before a build after a plan review: that review's verdict and open findings", () => {
    const review = facts('prv', 'PROJ-2', 'planreview', { tickets: { total: 3, done: 1, open: 2, inProgress: [], hitlOpen: [] }, review: { runs: 1, running: false, verdict: 'request-changes', openFindings: 2 } })
    const b = assembleBriefing({ graph: g, nodeId: 'b', facts: new Map([['prv', review]]), at: 'now' })
    expect(messages(b)).toEqual(expect.arrayContaining(["PROJ-2 TPROJ-2's verdict: changes needed.", 'PROJ-2 TPROJ-2 has 2 findings still open.']))
    expect(b.upstreams[0]!.project!.review).toMatchObject({ verdict: 'request-changes' })
  })
})

it('a plan review description says how the project works', () => {
  expect(planReviewDescription(null)).toMatch(/Pick the plan on the Review tab/)
})
