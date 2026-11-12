import { describe, expect, it } from 'vitest'
import {
  approvableBuilds,
  assembleTicketPlan,
  draftError,
  isDraftTicket,
  plannedForProblem,
  type DraftTicketLike,
} from '../app/utils/ticketPlan'
import { isRecordOnly, recordOnlyError } from '../app/utils/reviewFindings'
import { isFrontier, type Ticket } from '../app/composables/useTracker'
import { PROMPT_KIND_META, TICKET_PROMPT_KINDS, resolveTicketPlanPrompt } from '../app/utils/prompts'
import { ticketIsFrontier, ticketIsRecordOnly, type Ticket as StoreTicket } from '../server/utils/store'
import { ticketPlanBuildBlocker } from '../server/utils/ticketPlan'
import type { Graph, GraphNode } from '../app/utils/graphs'

const node = (id: string, mode: string, projectId: string | null = null, note = ''): GraphNode => ({
  id,
  mode,
  projectId,
  title: id.toUpperCase(),
  note,
  enteredAt: null,
  enteredNote: '',
  enteredBriefing: null,
  stackOn: null,
})
const graph = (nodes: GraphNode[], edges: Array<[string, string]>): Graph => ({
  id: 'g1',
  key: 'G-1',
  title: 'Cart',
  description: '',
  repo: '/r',
  nodes,
  edges: edges.map(([from, to]) => ({ from, to })),
  createdAt: '',
  updatedAt: '',
})
const t = (key: string, over: Partial<DraftTicketLike> = {}): DraftTicketLike => ({
  id: key.toLowerCase(),
  key,
  title: `${key} title`,
  type: 'story',
  status: 'todo',
  labels: ['afk'],
  blockedBy: [],
  acceptanceCriteria: ['works'],
  projectId: 'plan',
  plannedFor: null,
  ...over,
})

// plan → b1 → r1, b1 → b2 (stacked), r1 → b2, b2 → r2; b3 off the plan, no review.
const G = graph(
  [node('pn', 'plan', 'plan'), node('b1', 'standard', null, '**Slice:** schema'), node('r1', 'prreview'), node('b2', 'standard'), node('r2', 'prreview'), node('b3', 'standard')],
  [['pn', 'b1'], ['b1', 'r1'], ['b1', 'b2'], ['r1', 'b2'], ['b2', 'r2'], ['pn', 'b3']],
)
const projects = [{ id: 'plan', key: 'PROJ-1', title: 'Cart plan' }]

describe('a draft', () => {
  it('is a ticket with plannedFor', () => {
    expect(isDraftTicket({ plannedFor: 'b1' })).toBe(true)
    expect(isDraftTicket({ plannedFor: null })).toBe(false)
    expect(isDraftTicket({})).toBe(false)
  })

  it('is record-only on any project, and says why when dispatched', () => {
    expect(isRecordOnly({ labels: ['afk'], plannedFor: 'b1' }, 'plan')).toBe(true)
    expect(isRecordOnly({ labels: ['afk'] }, 'plan')).toBe(false)
    expect(isRecordOnly({ labels: ['afk'] }, 'prreview')).toBe(true)
    expect(recordOnlyError({ key: 'TICK-4', labels: ['afk'], plannedFor: 'b1' }, { key: 'PROJ-1', mode: 'plan' })).toBe(draftError({ key: 'TICK-4' }, { key: 'PROJ-1' }))
    expect(recordOnlyError({ key: 'TICK-4', labels: ['afk'] }, { key: 'PROJ-1', mode: 'plan' })).toBe('')
  })

  const full = (over: Partial<Ticket> = {}) =>
    ({ id: 'x', key: 'TICK-9', title: 'x', description: '', acceptanceCriteria: [], type: 'story', status: 'todo', projectId: 'plan', assignee: '', labels: ['afk'], resolution: '', blockedBy: [], comments: [], branch: '', prompt: '', promptMode: '', completedAt: null, pickedUpAt: null, origin: '', owner: '', transfer: '', transferAt: '', createdAt: '', updatedAt: '', ...over }) as Ticket

  it('is off the plan board frontier and the server frontier, and the auto engine never sees it as frontier', () => {
    const d = full({ plannedFor: 'b1' })
    const plain = full()
    expect(isFrontier(d, [d], { share: null, mode: 'plan' })).toBe(false)
    expect(isFrontier(plain, [plain], { share: null, mode: 'plan' })).toBe(true)
    const store = { projects: [{ id: 'plan', mode: 'plan' as const }] }
    expect(ticketIsRecordOnly(store, d as StoreTicket)).toBe(true)
    expect(ticketIsFrontier(d as StoreTicket, [d as StoreTicket], null)).toBe(false)
    expect(ticketIsFrontier(plain as StoreTicket, [plain as StoreTicket], null)).toBe(true)
  })
})

describe('plannedForProblem', () => {
  const plan = { key: 'PROJ-1', mode: 'plan' }
  it('accepts a build node of the plan’s graph', () => expect(plannedForProblem(plan, G, 'b1')).toBe(''))
  it('refuses a non-plan project, a plan in no graph, an unknown node and a review node', () => {
    expect(plannedForProblem({ key: 'PROJ-2', mode: 'standard' }, G, 'b1')).toMatch(/build project — drafts of a ticket plan live on its plan project/)
    expect(plannedForProblem(plan, null, 'b1')).toMatch(/ticket-plan\/graph first/)
    expect(plannedForProblem(plan, G, 'nope')).toMatch(/has no node nope/)
    expect(plannedForProblem(plan, G, 'r1')).toMatch(/review node/)
    expect(plannedForProblem(null, G, 'b1')).toMatch(/send projectId/)
  })
})

describe('assembleTicketPlan', () => {
  const tickets = [
    t('TICK-1'), // a resolved plan ticket? no — an open plain plan ticket
    t('TICK-2', { plannedFor: 'b1' }),
    t('TICK-3', { plannedFor: 'b1', blockedBy: ['tick-2'], labels: ['hitl'] }),
    t('TICK-4', { plannedFor: 'b2', blockedBy: ['tick-3', 'tick-1'] }),
    t('TICK-5', { plannedFor: 'b3', blockedBy: ['tick-4'] }), // b2 isn't upstream of b3
    t('TICK-6', { plannedFor: 'gone' }),
    t('TICK-7', { projectId: 'other', plannedFor: 'b1' }), // another project's: not this plan's draft
  ]
  const plan = assembleTicketPlan({ project: { id: 'plan' }, graph: G, tickets, projects })

  it('groups the drafts by build, in graph order, with the reviews after each', () => {
    expect(plan.planNodeId).toBe('pn')
    expect(plan.drafts).toBe(5)
    expect(plan.builds.map((b) => [b.nodeId, b.drafts.map((d) => d.key)])).toEqual([
      ['b1', ['TICK-2', 'TICK-3']],
      ['b3', ['TICK-5']],
      ['b2', ['TICK-4']],
    ])
    const b1 = plan.builds[0]!
    expect(b1).toMatchObject({ proposed: true, project: null, after: ['pn'], reviews: ['r1'], note: '**Slice:** schema' })
    expect(b1.drafts[1]).toMatchObject({ hitl: true, criteria: 1, blockedBy: [{ key: 'TICK-2', where: 'b1' }] })
    expect(plan.builds[2]!.after).toEqual(['b1', 'r1'])
    expect(plan.reviews.map((r) => r.nodeId)).toEqual(['r1', 'r2'])
  })

  it('keeps drafts whose node is gone apart, and warns about what approve can’t carry over', () => {
    expect(plan.unplaced.map((d) => d.key)).toEqual(['TICK-6'])
    const msgs = plan.problems.map((p) => `${p.level}:${p.ticket || p.nodeId}`)
    expect(msgs).toContain('warning:TICK-6') // no build
    expect(msgs).toContain('warning:TICK-5') // blocked by a build that isn't upstream
    expect(msgs).toContain('info:TICK-4') // waits on an open plan ticket
    expect(msgs).toContain('info:b3') // no review after it
    expect(msgs).not.toContain('warning:TICK-4') // b1 is upstream of b2: fine
  })

  it('lists an empty proposed build, and leaves a real build without drafts out', () => {
    const g = graph([node('pn', 'plan', 'plan'), node('b1', 'standard'), node('b9', 'standard', 'p9')], [['pn', 'b1'], ['pn', 'b9']])
    const p = assembleTicketPlan({ project: { id: 'plan' }, graph: g, tickets: [], projects })
    expect(p.builds.map((b) => b.nodeId)).toEqual(['b1'])
    expect(p.problems.map((x) => x.level + ':' + x.nodeId)).toEqual(['warning:b1', 'info:'])
  })

  it('says nothing about missing drafts once every build is approved', () => {
    const g = graph([node('pn', 'plan', 'plan'), node('b9', 'standard', 'p9')], [['pn', 'b9']])
    const p = assembleTicketPlan({ project: { id: 'plan' }, graph: g, tickets: [], projects })
    expect(p.problems).toEqual([])
  })

  it('answers a plan in no graph', () => {
    const p = assembleTicketPlan({ project: { id: 'plan' }, graph: null, tickets: [t('TICK-2', { plannedFor: 'b1' })], projects })
    expect(p).toMatchObject({ planNodeId: null, builds: [], drafts: 1 })
    expect(p.unplaced.map((d) => d.key)).toEqual(['TICK-2'])
    expect(p.problems[0]!.level).toBe('warning')
  })

  it('approves builds with drafts — all, or only those named; reviews never', () => {
    expect(approvableBuilds(plan).map((b) => b.nodeId)).toEqual(['b1', 'b3', 'b2'])
    expect(approvableBuilds(plan, ['b2', 'r1']).map((b) => b.nodeId)).toEqual(['b2'])
  })
})

describe('the ticketplan:build prompt', () => {
  const project = { id: 'p1', key: 'PROJ-1', title: 'Cart plan', repo: '~/code/cart', integrationBranch: '', prompts: {} } as any

  it('is a project-level Plan kind that names the skill and the ticket-plan API', () => {
    expect(PROMPT_KIND_META['ticketplan:build']).toMatchObject({ group: 'Plan', level: 'project', command: '/jplan-to-jtickets' })
    expect(TICKET_PROMPT_KINDS).not.toContain('ticketplan:build')
    const text = resolveTicketPlanPrompt(project, {})
    expect(text.startsWith('/jplan-to-jtickets PROJ-1 — turn the plan PROJ-1 (Cart plan) into a ticket plan.')).toBe(true)
    expect(text).toContain('GET http://localhost:43000/api/projects/PROJ-1/ticket-plan ')
    expect(text).toContain('POST http://localhost:43000/api/projects/PROJ-1/ticket-plan/built')
    expect(text).toContain('~/code/cart')
    expect(text).toContain('Propose only')
    expect(text).not.toMatch(/[{}\n]/)
  })

  it('resolves through the layers: project, then codebase, then the global default', () => {
    expect(resolveTicketPlanPrompt({ ...project, prompts: { 'ticketplan:build': 'plan {projectKey} small' } }, { 'ticketplan:build': 'global' }, { prompts: { 'ticketplan:build': 'codebase' } })).toBe('plan PROJ-1 small')
    expect(resolveTicketPlanPrompt(project, { 'ticketplan:build': 'global' }, { prompts: { 'ticketplan:build': 'codebase {repo}' } })).toBe('codebase ~/code/cart')
    expect(resolveTicketPlanPrompt(project, { 'ticketplan:build': 'global {projectTitle}' })).toBe('global Cart plan')
  })
})

describe('ticketPlanBuildBlocker', () => {
  const p = { key: 'PROJ-1', mode: 'plan' as const, repo: '~/code/cart', share: null }
  it('lets a plan with a repo draft', () => expect(ticketPlanBuildBlocker(p)).toBeNull())
  it('refuses a build project, a plan with no repo, and the peer side of a share', () => {
    expect(ticketPlanBuildBlocker({ ...p, mode: 'standard' })).toMatch(/is a build project/)
    expect(ticketPlanBuildBlocker({ ...p, repo: '' })).toMatch(/no repo/)
    expect(ticketPlanBuildBlocker({ ...p, share: { side: 'joiner' } as any })).toMatch(/shared with you/)
  })
})
