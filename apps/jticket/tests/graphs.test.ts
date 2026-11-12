import { describe, expect, it } from 'vitest'
import {
  assembleBriefing,
  coerceGraph,
  findCycle,
  graphLayers,
  graphOfProject,
  graphProblems,
  graphRows,
  graphSummary,
  graphThumbnail,
  graphUrl,
  mergeGraphShape,
  nodeStates,
  outcomeDocOf,
  projectWorkFinished,
  resolveGraph,
  seedGraphsFromBlockers,
  sliceIsLarge,
  sliceLabel,
  sliceDisplay,
  branchSharers,
  noteMarkdown,
  upstreamNodes,
  downstreamNodes,
  SLICE_LARGE_LINES,
  type Graph,
  type GraphNode,
  type GraphNodeState,
  type ProjectFacts,
} from '../app/utils/graphs'

const node = (id: string, mode: string, projectId: string | null = null, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  mode,
  projectId,
  title: id.toUpperCase(),
  note: '',
  enteredAt: null,
  enteredNote: '',
  enteredBriefing: null,
  stackOn: null,
  ...extra,
})
const graph = (nodes: GraphNode[], edges: Array<[string, string]>, extra: Partial<Graph> = {}): Graph => ({
  id: 'g1',
  key: 'G-1',
  title: 'Big thing',
  description: '',
  repo: '/r',
  nodes,
  edges: edges.map(([from, to]) => ({ from, to })),
  createdAt: '',
  updatedAt: '',
  ...extra,
})
const proj = (id: string, key: string, mode = 'standard') => ({ id, key, title: `Project ${key}`, mode })

// plan → build A → review A, build A → build B (stacked)
const chain = () =>
  graph(
    [node('plan', 'plan', 'p0'), node('a', 'standard', 'p1'), node('ra', 'prreview'), node('b', 'standard', null, { stackOn: 'a' })],
    [['plan', 'a'], ['a', 'ra'], ['a', 'b']],
  )

describe('lookups', () => {
  it('walks upstream and downstream, by mode and transitively', () => {
    const g = chain()
    expect(upstreamNodes(g, 'b').map((n) => n.id)).toEqual(['a'])
    expect(upstreamNodes(g, 'b', { transitive: true }).map((n) => n.id)).toEqual(['a', 'plan'])
    expect(upstreamNodes(g, 'ra', { mode: 'standard' }).map((n) => n.id)).toEqual(['a'])
    expect(upstreamNodes(g, 'b', { transitive: true, mode: 'plan' }).map((n) => n.id)).toEqual(['plan'])
    expect(downstreamNodes(g, 'a').map((n) => n.id)).toEqual(['ra', 'b'])
  })

  it('resolves a graph by id, key (any case), member project key, and the old derived id', () => {
    const g = chain()
    const projects = [proj('p0', 'PROJ-1'), proj('p1', 'PROJ-2'), proj('px', 'PROJ-9')]
    expect(resolveGraph([g], projects, 'g1')).toBe(g)
    expect(resolveGraph([g], projects, 'g-1')).toBe(g)
    expect(resolveGraph([g], projects, 'PROJ-2')).toBe(g)
    expect(resolveGraph([g], projects, 'p0')).toBe(g)
    expect(resolveGraph([g], projects, 'G-PROJ-1')).toBe(g)
    expect(resolveGraph([g], projects, 'PROJ-9')).toBeNull()
    expect(graphOfProject([g], 'p1')?.node.id).toBe('a')
  })
})

describe('graphProblems', () => {
  const ctx = { projects: [proj('p0', 'PROJ-1', 'plan'), proj('p1', 'PROJ-2')], otherGraphs: [] as Graph[] }

  it('passes a sound graph', () => {
    expect(graphProblems(chain(), ctx)).toEqual([])
  })

  it('finds a cycle', () => {
    const g = chain()
    g.edges.push({ from: 'b', to: 'plan' })
    expect(findCycle(g)).toEqual(['plan', 'a', 'b', 'plan'])
    expect(graphProblems(g, ctx).map((p) => p.message)).toEqual([expect.stringContaining('is a cycle')])
  })

  it('keeps a project to one node of one graph', () => {
    const g = chain()
    g.nodes.push(node('dup', 'standard', 'p1'))
    const other = graph([node('x', 'standard', 'p0')], [], { id: 'g2', key: 'G-2' })
    const msgs = graphProblems(g, { ...ctx, otherGraphs: [other] }).map((p) => p.message)
    expect(msgs).toContainEqual(expect.stringContaining('PROJ-2 Project PROJ-2 is in this graph twice'))
    expect(msgs).toContainEqual(expect.stringContaining('already in graph G-2'))
  })

  it('wants stackOn to name a direct upstream build, on a build', () => {
    const g = graph(
      [node('plan', 'plan', 'p0'), node('a', 'standard', 'p1'), node('b', 'standard', null, { stackOn: 'plan' }), node('c', 'standard', null, { stackOn: 'x' }), node('r', 'prreview', null, { stackOn: 'a' })],
      [['plan', 'a'], ['plan', 'b'], ['a', 'r']],
    )
    const msgs = graphProblems(g, ctx).map((p) => `${p.nodeId}: ${p.message}`)
    expect(msgs).toEqual([
      expect.stringMatching(/^b: .*which isn't a build/),
      expect.stringMatching(/^c: .*isn't directly before it/),
      expect.stringMatching(/^r: .*only a build stacks/),
    ])
  })

  it('flags a missing project and an untitled proposed node', () => {
    const g = graph([node('a', 'standard', 'gone'), node('b', 'standard', null, { title: ' ' })], [])
    expect(graphProblems(g, ctx).map((p) => p.message)).toEqual([expect.stringContaining('no longer exists'), expect.stringContaining('has no title')])
  })
})

describe('shape and layout', () => {
  it('lays nodes out by longest path, cycle-safe', () => {
    const g = chain()
    expect(graphLayers(g)).toEqual({ plan: 0, a: 1, ra: 2, b: 2 })
    expect(graphRows(g)).toEqual([['plan'], ['a'], ['ra', 'b']])
    g.edges.push({ from: 'b', to: 'plan' })
    expect(Object.keys(graphLayers(g))).toHaveLength(4)
  })

  it('merges a whole-shape save: new nodes minted, entered records kept unless the project changed', () => {
    const stored = graph([node('a', 'standard', 'p1', { enteredAt: 't', enteredNote: 'go', enteredBriefing: { x: 1 } }), node('b', 'standard', 'p2', { enteredAt: 't' })], [['a', 'b']])
    let n = 0
    const { nodes, edges, notes } = mergeGraphShape(
      stored,
      {
        nodes: [{ id: 'a', mode: 'standard', projectId: 'p1', title: 'A', enteredAt: 'forged' }, { id: 'b', projectId: 'p3' }, { mode: 'prreview', title: 'Review' }],
        edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'b', to: 'b' }, { from: 'b', to: 'nope' }],
      },
      () => `new${++n}`,
    )
    expect(nodes.map((x) => [x.id, x.projectId, x.enteredAt])).toEqual([['a', 'p1', 't'], ['b', 'p3', null], ['new1', null, null]])
    expect(nodes[0]!.enteredBriefing).toEqual({ x: 1 })
    expect(edges).toEqual([{ from: 'a', to: 'b' }])
    expect(notes).toHaveLength(1)
  })

  it('coerces a stored graph with defaults and drops dangling edges', () => {
    const g = coerceGraph({ id: 'g', key: 'G-4', nodes: [{ id: 'a', mode: 'wayfinder' }, { mode: 'x' }], edges: [{ from: 'a', to: 'zz' }] })!
    expect(g.nodes).toEqual([node('a', 'plan', null, { title: '' })])
    expect(g.edges).toEqual([])
    expect(coerceGraph({})).toBeNull()
  })
})

describe('node state', () => {
  it('reads proposed, finished, entered, waiting and ready', () => {
    const g = graph(
      [node('a', 'standard', 'p1'), node('b', 'standard', 'p2', { enteredAt: 't' }), node('c', 'prreview', 'p3'), node('d', 'standard', 'p4'), node('e', 'standard')],
      [['a', 'b'], ['b', 'c'], ['a', 'd'], ['c', 'e']],
    )
    const done = new Set(['p1'])
    expect(nodeStates(g, (n) => done.has(n.projectId!))).toEqual({ a: 'finished', b: 'entered', c: 'waiting', d: 'ready', e: 'proposed' })
  })

  it('calls a build finished when every ticket is and auto is off, a review when its latest review is back', () => {
    const t = (status: string) => ({ status })
    expect(projectWorkFinished({ mode: 'standard' }, [t('done'), t('merged')])).toBe(true)
    expect(projectWorkFinished({ mode: 'standard' }, [])).toBe(false)
    expect(projectWorkFinished({ mode: 'standard', auto: { enabled: true } }, [t('done')])).toBe(false)
    expect(projectWorkFinished({ mode: 'prreview', prReview: { runs: [{ status: 'done' }] } }, [t('todo')])).toBe(true)
    expect(projectWorkFinished({ mode: 'prreview', prReview: { runs: [{ status: 'done' }, { status: 'running' }] } }, [])).toBe(false)
  })

  it("picks a project's latest outcome-labelled doc", () => {
    const d = (key: string, projectId: string, labels: string[], updatedAt: string) => ({ key, projectId, labels, updatedAt })
    const docs = [d('DOC-1', 'a', ['outcome'], '2026-09-01'), d('DOC-2', 'a', ['outcome'], '2026-09-03'), d('DOC-3', 'a', ['spec'], '2026-09-09')]
    expect(outcomeDocOf(docs, 'a')?.key).toBe('DOC-2')
    expect(outcomeDocOf(docs, 'c')).toBeNull()
  })
})

describe('slice size', () => {
  it('labels and flags a slice', () => {
    expect(sliceLabel({ state: 'ok', files: 1, additions: 3, deletions: 0, base: 'main' })).toBe('1 file · +3 −0')
    expect(sliceLabel({ state: 'none', reason: 'x' })).toBe('no diff yet')
    expect(sliceIsLarge({ state: 'ok', files: 3, additions: SLICE_LARGE_LINES, deletions: 1, base: 'main' })).toBe(true)
    expect(sliceIsLarge({ state: 'ok', files: 3, additions: 100, deletions: 1, base: 'main' })).toBe(false)
    expect(sliceIsLarge({ state: 'unknown' })).toBe(false)
  })
})

describe('a node note', () => {
  it('keeps its single line breaks as markdown hard breaks, paragraphs as they are', () => {
    expect(noteMarkdown('**Slice:** a\n**Size:** b\n\nmore')).toBe('**Slice:** a  \n**Size:** b\n\nmore')
  })
})

describe('a branch several builds share', () => {
  const ps = [
    { id: 'p1', key: 'PROJ-46', repo: '/r/kraken', integrationBranch: 'studio', mode: 'standard' },
    { id: 'p2', key: 'PROJ-47', repo: '/r/kraken/', integrationBranch: 'studio', mode: 'standard' },
    { id: 'p3', key: 'PROJ-48', repo: '/r/kraken', integrationBranch: 'other', mode: 'standard' },
    { id: 'p4', key: 'PROJ-49', repo: '/r/elsewhere', integrationBranch: 'studio', mode: 'standard' },
    { id: 'p5', key: 'PROJ-50', repo: '/r/kraken', integrationBranch: 'studio', mode: 'prreview' },
  ]
  it('names the other builds on the same branch in the same codebase', () => {
    expect(branchSharers(ps, ps[0]!)).toEqual(['PROJ-47'])
    expect(branchSharers(ps, ps[2]!)).toEqual([])
    expect(branchSharers(ps, { id: 'x', repo: '/r/kraken', integrationBranch: '' })).toEqual([])
  })
  it('shows a shared branch as shared, never as this build\'s slice', () => {
    const s = { state: 'ok' as const, files: 60, additions: 2000, deletions: 300, base: 'master' }
    expect(sliceDisplay(s)).toMatchObject({ text: '60 files · +2000 −300', large: true, shared: false })
    const d = sliceDisplay(s, ['PROJ-47', 'PROJ-48'])
    expect(d).toMatchObject({ text: 'branch shared with PROJ-47, PROJ-48', large: false, shared: true })
    expect(d.title).toContain('60 files · +2000 −300 against master')
  })
  it('flags it before a review instead of calling it a large slice', () => {
    const g = graph([node('a', 'standard', 'p1', { enteredAt: 't' }), node('r', 'prreview', 'p2')], [['a', 'r']])
    const f = facts('p1', 'PROJ-46', 'standard', { sharedWith: ['PROJ-47'], slice: { state: 'ok', files: 60, additions: 2000, deletions: 300, base: 'master' } })
    const msgs = messages(assembleBriefing({ graph: g, nodeId: 'r', facts: new Map([['p1', f]]), at: 'now' }))
    expect(msgs).toContainEqual(expect.stringContaining('shares its integration branch proj-46-branch with PROJ-47 — it has no slice of its own'))
    expect(msgs.some((m) => m.includes('slice is large'))).toBe(false)
  })
})

const facts = (id: string, key: string, mode: string, extra: Partial<ProjectFacts> = {}): ProjectFacts => ({
  id,
  key,
  title: `T${key}`,
  mode,
  tickets: { total: 2, done: 2, open: 0, inProgress: [], hitlOpen: [] },
  auto: false,
  integrationBranch: `${key.toLowerCase()}-branch`,
  integrationBase: '',
  outcomeDoc: 'DOC-1',
  review: null,
  blockedOutside: [],
  rollup: { state: 'merged', number: 5, ci: 'passed' },
  branch: { known: true, base: 'main', behind: 0, ahead: 2, unpushed: 0, baseExists: true, upstreamMerged: false },
  slice: { state: 'ok', files: 4, additions: 120, deletions: 10, base: 'main' },
  ...extra,
})
const messages = (b: { flags: Array<{ message: string }> }) => b.flags.map((f) => f.message)

describe('assembleBriefing', () => {
  it('is quiet before a review when the build is in order, and states the slice', () => {
    const g = graph([node('a', 'standard', 'p1', { enteredAt: 't' }), node('r', 'prreview', 'p2')], [['a', 'r']])
    const b = assembleBriefing({ graph: g, nodeId: 'r', facts: new Map([['p1', facts('p1', 'PROJ-1', 'standard')]]), at: 'now' })
    expect(b.flags.filter((f) => f.level === 'warning')).toEqual([])
    expect(b.upstreams[0]!.project!.slice).toMatchObject({ files: 4 })
    expect(b.incomplete).toBe(false)
    expect(b.base).toBeNull()
  })

  it('warns before a review about open work, a large slice, a lagging branch and a missing PR', () => {
    const g = graph([node('a', 'standard', 'p1'), node('r', 'prreview')], [['a', 'r']])
    const f = facts('p1', 'PROJ-1', 'standard', {
      tickets: { total: 5, done: 3, open: 2, inProgress: ['TICK-9'], hitlOpen: [] },
      rollup: { state: 'none', ci: 'none' },
      branch: { known: true, base: 'main', behind: 3, ahead: 9, unpushed: 2, baseExists: true, upstreamMerged: false },
      slice: { state: 'ok', files: 60, additions: 2000, deletions: 300, base: 'main' },
      outcomeDoc: null,
    })
    const msgs = messages(assembleBriefing({ graph: g, nodeId: 'r', facts: new Map([['p1', f]]), at: 'now' }))
    for (const want of ['never moved on', 'TICK-9 in progress', '2 open tickets of 5', 'no roll-up PR open', '3 commits behind', '2 unpushed commits', 'no outcome report', 'slice is large — 60 files · +2000 −300', 'Moving on creates the review project']) {
      expect(msgs).toContainEqual(expect.stringContaining(want))
    }
  })

  it('says GitHub could not be asked, and does not wait for it, when gh failed', () => {
    const g = graph([node('a', 'standard', 'p1', { enteredAt: 't' }), node('r', 'prreview', 'p2')], [['a', 'r']])
    const f = facts('p1', 'PROJ-1', 'standard', { rollup: { state: 'unknown', ci: 'unknown', error: 'not a GitHub repo' } })
    const b = assembleBriefing({ graph: g, nodeId: 'r', facts: new Map([['p1', f]]), at: 'now' })
    expect(messages(b)).toContainEqual(expect.stringContaining("Couldn't ask GitHub about PROJ-1 TPROJ-1's roll-up PR: not a GitHub repo"))
    expect(b.incomplete).toBe(false)
  })

  it('says unknown rather than guessing, and marks the briefing incomplete', () => {
    const g = graph([node('a', 'standard', 'p1', { enteredAt: 't' }), node('r', 'prreview', 'p2')], [['a', 'r']])
    const f = facts('p1', 'PROJ-1', 'standard', { rollup: { state: 'unknown', ci: 'unknown' }, slice: { state: 'unknown' } })
    const b = assembleBriefing({ graph: g, nodeId: 'r', facts: new Map([['p1', f]]), at: 'now' })
    expect(b.incomplete).toBe(true)
    expect(messages(b)).toContainEqual(expect.stringContaining("GitHub hasn't answered yet"))
    expect(messages(b)).toContainEqual(expect.stringContaining("slice size isn't known yet"))
    expect(messages(b).join(' ')).not.toContain('no roll-up PR')
  })

  it('says a build has no diff yet instead of showing zeros', () => {
    const g = graph([node('a', 'standard', 'p1', { enteredAt: 't' }), node('r', 'prreview', 'p2')], [['a', 'r']])
    const f = facts('p1', 'PROJ-1', 'standard', { slice: { state: 'none', reason: 'no integration branch yet' } })
    expect(messages(assembleBriefing({ graph: g, nodeId: 'r', facts: new Map([['p1', f]]), at: 'now' }))).toContainEqual(expect.stringContaining('has no diff yet (no integration branch yet)'))
  })

  it('before a build: offers the upstream builds as bases and flags stacking past an unmerged sibling', () => {
    const g = graph(
      [node('a', 'standard', 'p1', { enteredAt: 't' }), node('b', 'standard', 'p2', { enteredAt: 't' }), node('rb', 'prreview', 'p3', { enteredAt: 't' }), node('c', 'standard', 'p4')],
      [['a', 'c'], ['b', 'c'], ['rb', 'c']],
    )
    const all = new Map([
      ['p1', facts('p1', 'PROJ-1', 'standard', { rollup: { state: 'open', number: 7, ci: 'failed' } })],
      ['p2', facts('p2', 'PROJ-2', 'standard', { rollup: { state: 'open', number: 8, ci: 'passed' } })],
      ['p3', facts('p3', 'PROJ-3', 'prreview', { review: { runs: 1, running: false, verdict: 'request-changes', openFindings: 2 }, tickets: { total: 2, done: 0, open: 2, inProgress: [], hitlOpen: [] } })],
      ['p4', facts('p4', 'PROJ-4', 'standard', { integrationBranch: '', tickets: { total: 3, done: 0, open: 3, inProgress: [], hitlOpen: ['TICK-5'] }, blockedOutside: [{ ticket: 'TICK-6', blocker: 'TICK-99' }] })],
    ])
    const b = assembleBriefing({ graph: g, nodeId: 'c', facts: all, stackOn: 'a', at: 'now' })
    expect(b.base).toMatchObject({ stackOn: 'a', branch: 'proj-1-branch', options: [{ nodeId: 'a' }, { nodeId: 'b' }] })
    const msgs = messages(b)
    for (const want of ['#7 has failing checks', "stacks on PROJ-1 while PROJ-2 isn't merged", 'verdict: changes needed', '2 findings still open', 'base to proj-1-branch', 'TICK-5', 'TICK-6 is blocked by TICK-99, outside this graph']) {
      expect(msgs).toContainEqual(expect.stringContaining(want))
    }
    // No stack: every unmerged upstream build is missing from the default branch.
    const flat = messages(assembleBriefing({ graph: g, nodeId: 'c', facts: all, stackOn: null, at: 'now' }))
    expect(flat.filter((m) => m.includes('starts from the default branch'))).toHaveLength(2)
  })

  it("flags a build that already has its branch from somewhere else", () => {
    const g = graph([node('a', 'standard', 'p1', { enteredAt: 't' }), node('b', 'standard', 'p2')], [['a', 'b']])
    const all = new Map([
      ['p1', facts('p1', 'PROJ-1', 'standard', { rollup: { state: 'open', number: 3, ci: 'passed' } })],
      ['p2', facts('p2', 'PROJ-2', 'standard', { integrationBranch: 'own', integrationBase: '' })],
    ])
    expect(messages(assembleBriefing({ graph: g, nodeId: 'b', facts: all, stackOn: 'a', at: 'now' }))).toContainEqual(expect.stringContaining("already has its integration branch (from the default branch) — moving on won't change its base"))
  })
})

describe('seedGraphsFromBlockers', () => {
  const p = (id: string, title: string, day: number, mode = 'standard') => ({ id, title, mode, repo: '/r', createdAt: `2026-09-0${day}T00:00:00.000Z` })
  const t = (id: string, projectId: string | null, blockedBy: string[] = []) => ({ id, projectId, blockedBy })

  it('turns each group of blocker-linked projects into a graph of entered nodes', () => {
    const projects = [p('a', 'Hollywood A', 1), p('b', 'Hollywood B', 2), p('c', 'Hollywood C', 3), p('solo', 'Solo', 4), p('r', 'Review', 5, 'prreview')]
    const tickets = [t('a1', 'a'), t('b1', 'b', ['a1']), t('b2', 'b', ['a1']), t('c1', 'c', ['b1']), t('s1', 'solo'), t('r1', 'r', ['c1'])]
    let n = 0
    const [g, ...rest] = seedGraphsFromBlockers(projects, tickets, () => `id${++n}`, 'now')
    expect(rest).toEqual([])
    expect(g!.title).toBe('Hollywood A → Hollywood C')
    expect(g!.nodes.map((x) => [x.projectId, x.enteredAt])).toEqual([['a', projects[0]!.createdAt], ['b', projects[1]!.createdAt], ['c', projects[2]!.createdAt]])
    const id = (pid: string) => g!.nodes.find((x) => x.projectId === pid)!.id
    expect(g!.edges).toEqual([{ from: id('a'), to: id('b') }, { from: id('b'), to: id('c') }])
    expect(g!.repo).toBe('/r')
  })

  it('makes nothing when no blocker crosses projects', () => {
    expect(seedGraphsFromBlockers([p('a', 'A', 1)], [t('a1', 'a'), t('a2', 'a', ['a1'])], () => 'x', 'now')).toEqual([])
  })
})

describe('the menu', () => {
  // A view-shaped node: what GET /api/graphs answers.
  const vn = (id: string, mode: string, state: GraphNodeState, extra: { running?: boolean; enteredAt?: string | null; project?: { key: string } | null } = {}) => ({
    id,
    mode,
    title: `T ${id}`,
    state,
    running: extra.running ?? false,
    enteredAt: extra.enteredAt ?? null,
    project: extra.project === undefined ? (state === 'proposed' ? null : { key: `PROJ-${id}` }) : extra.project,
  })
  const view = (nodes: ReturnType<typeof vn>[], edges: Array<[string, string]>) => ({
    nodes,
    edges: edges.map(([from, to]) => ({ from, to })),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  })

  it('links to a graph by key, with ?node= for a briefing', () => {
    expect(graphUrl('G-2')).toBe('/graphs/G-2')
    expect(graphUrl('G-2', 'n 1')).toBe('/graphs/G-2?node=n%201')
  })

  it('chains the types in flow order, folding a run of one type', () => {
    // plan → plan review → three stacked builds, each with its review
    const g = view(
      [
        vn('p', 'plan', 'finished'),
        vn('pr', 'planreview', 'finished'),
        vn('b1', 'standard', 'entered'),
        vn('b2', 'standard', 'proposed'),
        vn('b3', 'standard', 'proposed'),
        vn('r1', 'prreview', 'proposed'),
        vn('r2', 'prreview', 'proposed'),
        vn('r3', 'prreview', 'proposed'),
      ],
      [['p', 'pr'], ['pr', 'b1'], ['b1', 'b2'], ['b2', 'b3'], ['b3', 'r1'], ['b3', 'r2'], ['b3', 'r3']],
    )
    expect(graphSummary(g).chainLabel).toBe('Plan → Plan review → Build ×3 → Review ×3')
    // A layer of mixed types stays one step.
    const mixed = view([vn('b', 'standard', 'finished'), vn('r', 'prreview', 'ready'), vn('c', 'standard', 'ready')], [['b', 'r'], ['b', 'c']])
    expect(graphSummary(mixed).chainLabel).toBe('Build → Review + Build')
  })

  it('counts progress and says where the graph is now', () => {
    const g = view(
      [
        vn('a', 'standard', 'finished', { enteredAt: '2026-11-03T00:00:00.000Z' }),
        vn('b', 'standard', 'entered', { enteredAt: '2026-11-04T00:00:00.000Z', running: true }),
        vn('r', 'prreview', 'ready'),
        vn('c', 'standard', 'proposed'),
      ],
      [['a', 'b'], ['a', 'r'], ['b', 'c']],
    )
    const s = graphSummary(g, ['2026-11-05T00:00:00.000Z', ''])
    expect(s).toMatchObject({ total: 4, finished: 1, entered: 2, proposed: 1, running: 1, done: false, lastChanged: '2026-11-05T00:00:00.000Z' })
    expect(s.states).toEqual({ proposed: 1, waiting: 0, ready: 1, entered: 1, finished: 1 })
    // Flow order: b and r are both one layer down from a.
    expect(s.now.map((n) => [n.nodeId, n.state, n.projectKey])).toEqual([['b', 'entered', 'PROJ-b'], ['r', 'ready', 'PROJ-r']])
  })

  it('points at the next proposed node when nothing is under way', () => {
    const g = view([vn('a', 'standard', 'finished'), vn('b', 'prreview', 'proposed'), vn('c', 'standard', 'proposed')], [['a', 'b'], ['b', 'c']])
    const s = graphSummary(g)
    expect(s.now.map((n) => [n.nodeId, n.projectKey])).toEqual([['b', null]])
    expect(s.lastChanged).toBe('2026-11-02T00:00:00.000Z')
    const done = graphSummary(view([vn('a', 'plan', 'finished')], []))
    expect(done.done).toBe(true)
    expect(done.now).toEqual([])
    expect(graphSummary(view([], [])).done).toBe(false)
  })

  it('lays the thumbnail out a row per layer, each row centred', () => {
    const t = graphThumbnail(graph([node('a', 'standard'), node('b', 'standard'), node('c', 'prreview')], [['a', 'b'], ['a', 'c']]))
    expect([t.cols, t.rows]).toEqual([2, 2])
    expect(t.nodes).toEqual([{ id: 'a', x: 1, y: 0.5 }, { id: 'b', x: 0.5, y: 1.5 }, { id: 'c', x: 1.5, y: 1.5 }])
    expect(t.edges[0]).toEqual({ from: 'a', to: 'b', x1: 1, y1: 0.5, x2: 0.5, y2: 1.5 })
    expect(graphThumbnail(graph([], []))).toEqual({ cols: 1, rows: 1, nodes: [], edges: [] })
  })
})
