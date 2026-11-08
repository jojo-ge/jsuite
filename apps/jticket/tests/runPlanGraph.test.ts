import { describe, expect, it } from 'vitest'
import { REVIEW_DEFAULT, type PlanDispatch, type PlanStep, type RunPlan } from '../app/utils/runPlan'
import { GRAPH, layoutRunPlan, reviewRanges, type GraphTicketInfo } from '../app/utils/runPlanGraph'

const s = (id: string, kind: PlanStep['kind'], patch: Partial<PlanStep> = {}): PlanStep => ({
  id,
  kind,
  tickets: [],
  reviewers: 2,
  base: '',
  note: '',
  dispatch: null,
  groups: [],
  groupRunners: [],
  runners: {},
  review: { ...REVIEW_DEFAULT },
  ...patch,
})
const plan = (...steps: PlanStep[]): RunPlan => ({ steps })
const run: PlanDispatch = { mode: 'sessions', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 }
const info = (keys: string[], patch: Record<string, Partial<GraphTicketInfo>> = {}): Record<string, GraphTicketInfo> =>
  Object.fromEntries(keys.map((k) => [k, { key: k, title: `about ${k}`, hitl: false, paused: false, finished: false, blockedBy: [], ...patch[k] }]))

describe('layoutRunPlan — a horizontal pipeline', () => {
  it('puts the steps on the spine left to right, Start before and End after, every node centred on it', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'merge'), s('s3', 'review'), s('s4', 'gate', { note: 'check staging' }))
    const l = layoutRunPlan(p, info(['T-1']), run)
    expect(l.nodes.map((n) => n.kind)).toEqual(['implement', 'merge', 'review', 'gate'])
    expect(l.start.x + l.start.w).toBeLessThan(l.nodes[0]!.x)
    for (let i = 1; i < l.nodes.length; i++) expect(l.nodes[i]!.x).toBeGreaterThan(l.nodes[i - 1]!.x + l.nodes[i - 1]!.w)
    expect(l.end.x).toBeGreaterThan(l.nodes[3]!.x + l.nodes[3]!.w)
    expect(l.width).toBeGreaterThan(l.end.x + l.end.w)
    for (const n of [l.start, ...l.nodes, l.end]) expect(n.y + n.h / 2).toBe(l.spineY)
    // One flow edge into each node and one into End, each spanning the gap on the spine.
    expect(l.flows.map((f) => f.to)).toEqual([0, 1, 2, 3, 4])
    for (const f of l.flows) {
      expect(f.y).toBe(l.spineY)
      expect(f.x2 - f.x1).toBe(GRAPH.gap)
    }
    expect(l.nodes.map((n) => n.summary)).toEqual(['1 own agent', 'lands the open PRs', '2 reviewers · Opus 5.5 medium', 'check staging'])
    // Implement columns are wider than the single-node steps.
    expect(l.nodes[0]!.w).toBe(GRAPH.implW)
    expect(l.nodes[1]!.w).toBe(GRAPH.mergeW)
    expect(l.nodes[2]!.w).toBe(GRAPH.nodeW)
  })

  it('hangs a card per ticket under an implement node — orchestrator boxes first, then the own agents — and the drawing grows down to fit', () => {
    const step = s('s1', 'implement', {
      tickets: ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'],
      dispatch: { ...run, model: 'opus', effort: 'high' },
      groups: [['T-3', 'T-4', 'T-5']],
      groupRunners: [{ model: 'sonnet', effort: 'low' }],
      runners: { 'T-2': { model: 'haiku', effort: 'low' } },
    })
    const l = layoutRunPlan(plan(step), info(['T-1', 'T-2', 'T-3', 'T-4', 'T-5'], { 'T-4': { hitl: true } }), run)
    const node = l.nodes[0]!
    expect(l.boxes.map((b) => [b.group, b.label, b.tickets, b.queueY])).toEqual([
      [0, 'Orchestrator 1 · Sonnet 5.5 low', ['T-3', 'T-4', 'T-5'], null],
      [null, 'Own agents', ['T-1', 'T-2'], null],
    ])
    expect(l.tickets.find((t) => t.key === 'T-1')).toMatchObject({ group: null, order: 1, queued: false, runner: 'Opus 5.5 high' })
    expect(l.tickets.find((t) => t.key === 'T-2')).toMatchObject({ group: null, order: 2, queued: false, runner: 'Haiku 5.5 low' })
    expect(l.tickets.find((t) => t.key === 'T-3')).toMatchObject({ group: 0, order: null, queued: false, runner: 'Sonnet 5.5 low' })
    expect(l.tickets.find((t) => t.key === 'T-4')).toMatchObject({ group: 0, hitl: true })
    expect(l.tickets.find((t) => t.key === 'T-5')).toMatchObject({ group: 0, runner: 'Sonnet 5.5 low' })
    expect(node.summary).toBe('2 own agents · 1 orchestrator')
    // Boxes sit under the node, stacked without overlap, inside the column; every card inside its box.
    let last = node.y + node.h
    for (const b of l.boxes) {
      expect(b.y).toBeGreaterThan(last)
      expect(b.x).toBe(node.x)
      expect(b.w).toBe(node.w)
      last = b.y + b.h
      for (const t of l.tickets.filter((t) => t.group === b.group)) {
        expect(t.y).toBeGreaterThanOrEqual(b.y + GRAPH.boxHead)
        expect(t.y + t.h).toBeLessThanOrEqual(b.y + b.h)
        expect(t.x).toBeGreaterThan(b.x)
        expect(t.x + t.w).toBeLessThan(b.x + b.w)
      }
    }
    expect(l.height).toBeGreaterThan(last)
    // A plan with no tickets stays as tall as the spine needs.
    const bare = layoutRunPlan(plan(s('s1', 'merge')), {}, run)
    expect(bare.height).toBe(bare.spineY + GRAPH.nodeH / 2 + GRAPH.pad)
  })

  it('own agents past the step\'s free sessions are queued, in the step\'s order, with the queue line between', () => {
    const six = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']
    // Own agents only: 4 at once, two queued.
    const solo = layoutRunPlan(plan(s('s1', 'implement', { tickets: six })), info(six), run)
    expect(solo.tickets.map((t) => [t.order, t.queued])).toEqual([[1, false], [2, false], [3, false], [4, false], [5, true], [6, true]])
    const box = solo.boxes[0]!
    expect(box.label).toBe('Own agents · 4 at once, 2 queued')
    // The line sits between the 4th and the 5th card.
    const fourth = solo.tickets[3]!
    const fifth = solo.tickets[4]!
    expect(box.queueY).toBeGreaterThan(fourth.y + fourth.h)
    expect(box.queueY).toBeLessThan(fifth.y)
    expect(solo.nodes[0]!.summary).toBe('6 own agents (4 at once)')
    // Beside an orchestrator: 3 at once.
    const mixed = layoutRunPlan(plan(s('s1', 'implement', { tickets: six, groups: [['T-6']] })), info(six), run)
    expect(mixed.tickets.filter((t) => t.group === null).map((t) => [t.key, t.queued])).toEqual([['T-1', false], ['T-2', false], ['T-3', false], ['T-4', true], ['T-5', true]])
    expect(mixed.boxes.find((b) => b.group === null)!.label).toBe('Own agents · 3 at once, 2 queued')
    // Two orchestrators: nothing runs as its own agent — the box says so (planProblems refuses the plan).
    const two = layoutRunPlan(plan(s('s1', 'implement', { tickets: six, groups: [['T-1'], ['T-2']] })), info(six), run)
    expect(two.boxes.find((b) => b.group === null)!.label).toBe('Own agents · none beside 2 orchestrators')
    expect(two.tickets.filter((t) => t.group === null).every((t) => t.queued)).toBe(true)
  })

  it('a ticket the project lacks is drawn as unknown', () => {
    const l = layoutRunPlan(plan(s('s1', 'implement', { tickets: ['T-9'] })), {}, run)
    expect(l.tickets[0]).toMatchObject({ key: 'T-9', unknown: true, title: '(unknown ticket)' })
  })

  it('marks the spine into every implement step after the first as a slice report', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-2'] }), s('s4', 'review'), s('s5', 'implement', { tickets: ['T-3'] }))
    const l = layoutRunPlan(p, info(['T-1', 'T-2', 'T-3']), run)
    expect(l.flows.filter((f) => f.slice).map((f) => f.to)).toEqual([2, 4])
    expect(l.nodes.map((n) => n.readsSlice)).toEqual([false, false, true, false, true])
  })
})

describe('review arcs — what each review reads', () => {
  const p = plan(
    s('s1', 'implement', { tickets: ['T-1'] }),
    s('s2', 'merge'),
    s('s3', 'review'), // since the start
    s('s4', 'implement', { tickets: ['T-2'] }),
    s('s5', 'merge'),
    s('s6', 'review'), // since the previous review (s3)
    s('s7', 'review', { base: 'start' }), // everything
    s('s8', 'review', { base: 's4' }), // since step 4
  )

  it('resolves each review’s checkpoint: the plan start, the previous review, or the step it names', () => {
    expect(reviewRanges(p)).toEqual([
      { stepIndex: 2, fromStep: -1, label: 'everything since the plan started' },
      { stepIndex: 5, fromStep: 2, label: 'changes since the review in step 3' },
      { stepIndex: 6, fromStep: -1, label: 'everything since the plan started' },
      { stepIndex: 7, fromStep: 3, label: 'changes since step 4' },
    ])
  })

  it('draws an arc above the spine from the checkpoint to the review node, overlapping ones in higher lanes', () => {
    const l = layoutRunPlan(p, info(['T-1', 'T-2']), run)
    const [a, b, c, d] = l.reviews
    expect(a).toMatchObject({ stepIndex: 2, fromX: l.start.x + l.start.w, toX: l.nodes[2]!.x + l.nodes[2]!.w / 2 })
    expect(b).toMatchObject({ stepIndex: 5, fromX: l.nodes[2]!.x + l.nodes[2]!.w })
    expect(d).toMatchObject({ stepIndex: 7, fromX: l.nodes[3]!.x + l.nodes[3]!.w })
    // a (start→s3) and b (s3→s6) touch, so share lane 0; c (start→s7) overlaps both; d (s4→s8) overlaps c.
    expect(a!.lane).toBe(0)
    expect(b!.lane).toBe(0)
    expect(c!.lane).toBe(1)
    expect(d!.lane).not.toBe(c!.lane)
    // Lane 0 is nearest the nodes; higher lanes are higher up, all above the nodes and inside the drawing.
    expect(a!.laneY).toBeLessThan(l.nodes[0]!.y)
    expect(c!.laneY).toBeLessThan(a!.laneY)
    expect(c!.laneY).toBeGreaterThan(0)
    // No review → the nodes start at the top padding.
    expect(layoutRunPlan(plan(s('s1', 'implement', { tickets: ['T-1'] })), info(['T-1']), run).nodes[0]!.y).toBe(GRAPH.pad)
  })
})

describe('blocker edges', () => {
  it('joins placed cards, ok only when the blocker runs in an earlier step with a merge between', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1', 'T-5'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-2', 'T-3'] }), s('s4', 'implement', { tickets: ['T-4'] }))
    const l = layoutRunPlan(
      p,
      info(['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-8'], {
        'T-2': { blockedBy: ['T-1'] }, // earlier, merge between → ok
        'T-3': { blockedBy: ['T-2'] }, // same step → not ok
        'T-4': { blockedBy: ['T-3', 'T-8'] }, // no merge between → not ok; T-8 unplaced → no edge
        'T-5': { blockedBy: ['T-5'] }, // self → ignored
      }),
      run,
    )
    expect(l.blockers.map((b) => [b.from, b.to, b.ok])).toEqual([
      ['T-1', 'T-2', true],
      ['T-2', 'T-3', false],
      ['T-3', 'T-4', false],
    ])
    // Across columns: right edge → left edge. Same column: bottom → top.
    const across = l.blockers[0]!
    const from = l.tickets.find((t) => t.key === 'T-1')!
    const to = l.tickets.find((t) => t.key === 'T-2')!
    expect(across).toMatchObject({ x1: from.x + from.w, y1: from.y + from.h / 2, x2: to.x, y2: to.y + to.h / 2 })
    const same = l.blockers[1]!
    const t2 = l.tickets.find((t) => t.key === 'T-2')!
    const t3 = l.tickets.find((t) => t.key === 'T-3')!
    expect(same).toMatchObject({ x1: t2.x + t2.w / 2, y1: t2.y + t2.h, x2: t3.x + t3.w / 2, y2: t3.y })
  })
})
