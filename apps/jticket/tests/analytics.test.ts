// Stitching sessions into ticket rows (analytics.ts), rolling them up
// (analyticsRollup.ts) and matching old transcripts back to tickets
// (analyticsBackfill.ts) — over fixture transcripts and a synthetic store.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TranscriptBuilder, T } from './fixtures/transcript'
import { cwdSlug } from '../server/utils/transcripts'
import { buildAnalytics } from '../server/utils/analytics'
import { compare, concurrencyView, league, median, rollup, summarize, weekOf, weekly } from '../server/utils/analyticsRollup'
import { focusCommand } from '../server/utils/verification'
import { backfillSessions, loopAt, matchPrompt } from '../server/utils/analyticsBackfill'
import { loadSessions, saveSessions, sessionRow } from '../server/utils/sessions'
import type { Store, Ticket, Project, LocalPr } from '../server/utils/store'

const root = mkdtempSync(join(tmpdir(), 'jt-analytics-'))
const prev = process.env.CLAUDE_PROJECTS_DIR
beforeAll(() => {
  process.env.CLAUDE_PROJECTS_DIR = root
})
afterAll(() => {
  if (prev === undefined) delete process.env.CLAUDE_PROJECTS_DIR
  else process.env.CLAUDE_PROJECTS_DIR = prev
})

const REPO = '/repo'
const project = (id: string, key: string, over: Partial<Project> = {}): Project =>
  ({ id, key, title: key, description: '', mode: 'standard', repo: REPO, integrationBranch: 'proj/x', starred: false, position: null, hidden: false, share: null, prompts: {}, auto: null, runPlan: null, runPlanBuild: null, createdAt: T(0), updatedAt: T(0), ...over }) as Project
const ticket = (id: string, key: string, projectId: string, over: Partial<Ticket> = {}): Ticket =>
  ({ id, key, title: key, description: '', acceptanceCriteria: [], type: 'task', status: 'todo', projectId, assignee: '', labels: ['afk'], resolution: '', blockedBy: [], comments: [], branch: '', prompt: '', promptMode: '', completedAt: null, pickedUpAt: null, origin: '', owner: '', transfer: '', transferAt: '', createdAt: T(0), updatedAt: T(0), ...over }) as Ticket
const pr = (id: string, ticketId: string, projectId: string, createdAt: string, over: Partial<LocalPr> = {}): LocalPr =>
  ({ id, key: id.toUpperCase(), title: '', description: '', ticketId, projectId, headBranch: 'tick/x', baseBranch: 'proj/x', status: 'open', conflictFiles: [], mergeCommit: '', mergeParent: '', mergedAt: null, createdAt, updatedAt: createdAt, ...over }) as LocalPr
const store = (over: Partial<Store> = {}): Store =>
  ({ projects: [], tickets: [], docs: [], prs: [], repos: [{ path: REPO, slug: 'o/r', defaultBranch: 'main', lastUsedAt: '', prompts: {}, worktreeGuide: null, worktreeLinks: [], verificationRules: [] }], shares: [], promptDefaults: {}, counters: { project: 0, ticket: 0, doc: 0, pr: 0 }, ...over }) as Store

const VITEST_OK = '\n Test Files  3 passed (3)\n      Tests  12 passed (12)\n   Duration  2.40s\n'
const VITEST_ONE = '\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration  0.80s\n'
const dir = join(root, cwdSlug(REPO))

describe('buildAnalytics', () => {
  it('stitches a solo ticket, an orchestrated ticket and a merge job into rows', async () => {
    // Solo: picked up at 0, session 10s → 600s, first edit at 70s, whole run 100→160, filtered run 200→210, PR at 300 (record), closed at 320.
    new TranscriptBuilder('solo-1', REPO)
      .prompt(T(10), '/jimplement TICK-1 in a worktree')
      .assistant(T(12), { tools: [{ id: 'r', name: 'Read', input: {} }], usage: { input_tokens: 1000, output_tokens: 100 } })
      .result(T(13), 'r', 'x')
      .assistant(T(70), { tools: [{ id: 'e', name: 'Edit', input: {} }], usage: { output_tokens: 100 } })
      .result(T(71), 'e', 'ok')
      .assistant(T(100), { tools: [{ id: 't1', name: 'Bash', input: { command: 'pnpm test' } }], usage: { output_tokens: 10 } })
      .result(T(160), 't1', VITEST_OK)
      .assistant(T(200), { tools: [{ id: 't2', name: 'Bash', input: { command: 'pnpm vitest run tests/a.test.ts' } }], usage: { output_tokens: 10 } })
      .result(T(210), 't2', VITEST_ONE)
      .assistant(T(600), { text: 'done', usage: { output_tokens: 10 } })
      .write(dir)
    // Orchestrated: claim at 1000, implementer 1010→1300 (edit at 1050, whole run 1100→1220), spec check 1320→1340, second implementer (fix) 1400→1450.
    const orch = new TranscriptBuilder('orch-1', REPO, 'claude-fable-5-2')
      .prompt(T(900), '/jorchestrate PROJ-1 — jTicket\'s auto loop, implementing phase')
      .assistant(T(1005), { tools: [{ id: 'a1', name: 'Agent', input: { description: 'Implement TICK-2', prompt: 'You are implementing TICK-2. Invoke the jimplement skill with this hand-off: …' } }], usage: { input_tokens: 500, output_tokens: 200 } })
      .result(T(1006), 'a1', 'launched', { toolUseResult: { agentId: 'i1' } })
      .assistant(T(1310), { tools: [{ id: 'a2', name: 'Agent', input: { description: 'Spec-review TICK-2', prompt: 'Spec-review TICK-2. … VERDICT: PASS or VERDICT: FAIL' } }], usage: { output_tokens: 100 } })
      .result(T(1311), 'a2', 'launched', { toolUseResult: { agentId: 's1' } })
      .assistant(T(1390), { tools: [{ id: 'a3', name: 'Agent', input: { description: 'Fix TICK-2', prompt: 'You are implementing TICK-2 (fix round). Invoke the jimplement skill …' } }], usage: { output_tokens: 100 } })
      .result(T(1391), 'a3', 'launched', { toolUseResult: { agentId: 'i2' } })
      .assistant(T(1500), { text: 'phase done', usage: { output_tokens: 50 } })
    const i1 = new TranscriptBuilder('orch-1', REPO).prompt(T(1010), 'You are implementing TICK-2').assistant(T(1050), { tools: [{ id: 'e', name: 'Write', input: {} }], usage: { input_tokens: 2000, output_tokens: 300 } }).result(T(1051), 'e', 'ok').assistant(T(1100), { tools: [{ id: 't', name: 'Bash', input: { command: 'pnpm test' } }], usage: { output_tokens: 10 } }).result(T(1220), 't', VITEST_OK).assistant(T(1300), { text: 'PR-2', usage: { output_tokens: 10 } })
    const s1 = new TranscriptBuilder('orch-1', REPO).prompt(T(1320), 'Spec-review TICK-2').assistant(T(1340), { text: 'VERDICT: FAIL', usage: { output_tokens: 40 } })
    const i2 = new TranscriptBuilder('orch-1', REPO).prompt(T(1400), 'fix').assistant(T(1420), { tools: [{ id: 'e', name: 'Edit', input: {} }], usage: { output_tokens: 30 } }).result(T(1421), 'e', 'ok').assistant(T(1450), { text: 'fixed', usage: { output_tokens: 10 } })
    orch.write(dir, [
      { agentId: 'i1', toolUseId: 'a1', builder: i1 },
      { agentId: 's1', toolUseId: 'a2', builder: s1 },
      { agentId: 'i2', toolUseId: 'a3', builder: i2 },
    ])
    // Merge sweep job with one guards run.
    new TranscriptBuilder('merge-1', REPO, 'claude-sonnet-5').prompt(T(2000), 'merge sweep PR-1, PR-2').assistant(T(2010), { tools: [{ id: 'g', name: 'Bash', input: { command: 'bin/check' } }], usage: { input_tokens: 100, output_tokens: 50 } }).result(T(2050), 'g', 'ok').assistant(T(2060), { text: 'merged', usage: { output_tokens: 5 } }).write(dir)

    const st = store({
      projects: [project('p1', 'PROJ-1')],
      tickets: [
        ticket('t1', 'TICK-1', 'p1', { status: 'merged', pickedUpAt: T(0), completedAt: T(320), labels: ['afk', 'jreview'] }),
        ticket('t2', 'TICK-2', 'p1', { status: 'done', pickedUpAt: T(1000), completedAt: T(1460) }),
        ticket('t3', 'TICK-3', 'p1', { status: 'todo' }),
      ],
      prs: [pr('pr_1', 't1', 'p1', T(300), { status: 'merged', mergedAt: T(2055) }), pr('pr_2', 't2', 'p1', T(1290))],
    })
    const sessions = [
      sessionRow({ id: 'solo-1', role: 'implement', ticketKey: 'TICK-1', projectId: 'p1', projectKey: 'PROJ-1', repo: REPO, cwd: REPO, loop: 1, model: 'claude-opus-5-5', effort: 'high', dispatchedAt: T(5) }),
      sessionRow({ id: 'orch-1', role: 'orchestrate', tickets: ['TICK-2'], projectId: 'p1', projectKey: 'PROJ-1', repo: REPO, cwd: REPO, loop: 2, orchestrator: 1, model: 'claude-fable-5-2', dispatchedAt: T(899) }),
      sessionRow({ id: 'merge-1', role: 'merge', projectId: 'p1', projectKey: 'PROJ-1', repo: REPO, cwd: REPO, loop: 2, model: 'claude-sonnet-5', dispatchedAt: T(1999) }),
      sessionRow({ id: 'gone-1', role: 'implement', ticketKey: 'TICK-3', projectId: 'p1', projectKey: 'PROJ-1', repo: REPO, cwd: REPO, dispatchedAt: T(3000) }),
    ]
    const data = await buildAnalytics(st, { projectIds: new Set(['p1']) }, sessions)
    expect(data.ledger).toEqual({ sessions: 4, withTranscript: 3, missing: 1 })

    const t1 = data.tickets.find((r) => r.key === 'TICK-1')!
    expect(t1).toMatchObject({ mode: 'solo', loop: 1, model: 'claude-opus-5-5', effort: 'high', pickedUpAt: T(0), sessionStart: T(10), firstEditAt: T(70), firstTestAt: T(100), prOpenedAt: T(300), completedAt: T(320), sessionEnd: T(600), reviewFiled: true, sessions: 1 })
    expect(t1.phases).toMatchObject({ waitMs: 10_000, researchMs: 60_000, buildMs: 230_000, verificationMs: 70_000, toPrMs: 290_000, toCloseMs: 320_000, tailMs: 280_000, sessionMs: 590_000 })
    expect(t1.verification).toMatchObject({ count: 2, whole: 1, wholeMs: 60_000, filtered: 1, filteredMs: 10_000 })
    expect(t1.cost.usd).toBeGreaterThan(0)

    const t2 = data.tickets.find((r) => r.key === 'TICK-2')!
    expect(t2).toMatchObject({ mode: 'orchestrated', loop: 2, pickedUpAt: T(1000), sessionStart: T(1010), firstEditAt: T(1050), prOpenedAt: T(1290), completedAt: T(1460), sessionEnd: T(1450), sessions: 3, implementers: 2, specChecks: 1 })
    expect(t2.phases).toMatchObject({ waitMs: 10_000, researchMs: 40_000, toCloseMs: 460_000, verificationMs: 120_000 })
    expect(t2.sessionIds).toEqual(['orch-1/i1', 'orch-1/s1', 'orch-1/i2'])

    const t3 = data.tickets.find((r) => r.key === 'TICK-3')!
    expect(t3).toMatchObject({ mode: 'none', sessions: 0, missing: ['gone-1'] })
    expect(t3.phases.toCloseMs).toBeNull()

    expect(data.orchestrations).toHaveLength(1)
    const o = data.orchestrations[0]!
    expect(o).toMatchObject({ sessionId: 'orch-1', loop: 2, orchestrator: 1, tickets: ['TICK-2'], implementers: 2, specChecks: 1, startedAt: T(900), endedAt: T(1500), durationMs: 600_000 })
    expect(o.specCheckLatencyMs).toBe(20_000) // implementer ended 1300, spec started 1320
    expect(o.idleMs).toBe(600_000 - (290_000 + 20_000 + 50_000))
    expect(o.overheadRatio).toBeGreaterThan(0)
    expect(o.concurrency.max).toBe(1)

    expect(data.jobs).toHaveLength(1)
    expect(data.jobs[0]).toMatchObject({ role: 'merge', model: 'claude-sonnet-5', durationMs: 60_000 })
    expect(data.jobs[0]!.verification).toMatchObject({ count: 1 })
    expect(data.jobs[0]!.verification.byCategory.guards).toEqual({ count: 1, wallMs: 40_000 })

    // Heavy runs: the two whole suite runs (60s + 120s) and the 40s guards run is neither whole-test… it IS whole scope, so three.
    expect(data.heavyRuns.map((h) => [h.ticketKey, h.category])).toEqual([
      ['TICK-1', 'test'],
      ['TICK-2', 'test'],
      ['', 'guards'],
    ])

    // Rollup over it.
    const r = rollup(data)
    expect(r.summary).toMatchObject({ tickets: 3, finished: 2, wholeRuns: 2, filteredRuns: 1, fixRounds: 1 })
    expect(r.summary.medianToCloseMs).toBe((320_000 + 460_000) / 2)
    expect(r.spend.total).toBeCloseTo(r.spend.tickets + r.spend.orchestration + r.spend.jobs, 9)
    expect(Object.keys(r.spend.byRole).sort()).toEqual(['implement', 'merge', 'orchestrate', 'subagent'])
    expect(r.verification.topCommands[0]).toMatchObject({ command: 'pnpm test', count: 2, whole: 2, wallMs: 180_000 })
    expect(r.league).toHaveLength(1)
    expect(r.league[0]).toMatchObject({ projectKey: 'PROJ-1', orchestrations: 1 })
    expect(r.byMode.map((g) => g.key).sort()).toEqual(['none', 'orchestrated', 'solo'])
    expect(r.orchestration).toMatchObject({ count: 1, medianSpecCheckLatencyMs: 20_000 })
    expect(r.concurrency.peak).toBe(1)
    expect(r.weekly).toHaveLength(1)
    expect(r.weekly[0]).toMatchObject({ week: '2026-11-02', tickets: 2 }) // TICK-3 was never picked up, so it has no week
  })

  it('filters by repo and date, and the global view drops never-touched tickets', async () => {
    const st = store({
      projects: [project('p1', 'PROJ-1'), project('p9', 'PROJ-9', { repo: '/elsewhere' })],
      tickets: [ticket('t1', 'TICK-1', 'p1', { pickedUpAt: T(0) }), ticket('t9', 'TICK-9', 'p9'), ticket('t8', 'TICK-8', 'p1')],
    })
    const sessions = [sessionRow({ id: 'solo-1', role: 'implement', ticketKey: 'TICK-1', projectId: 'p1', projectKey: 'PROJ-1', repo: REPO, cwd: REPO, dispatchedAt: T(5) })]
    const all = await buildAnalytics(st, {}, sessions)
    expect(all.tickets.map((t) => t.key)).toEqual(['TICK-1'])
    expect((await buildAnalytics(st, { repo: '/elsewhere' }, sessions)).tickets).toEqual([])
    expect((await buildAnalytics(st, { from: T(10) }, sessions)).ledger.sessions).toBe(0)
    expect((await buildAnalytics(st, { to: T(10) }, sessions)).ledger.sessions).toBe(1)
  })
})

describe('rollup helpers', () => {
  it('median, week, compare', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(weekOf('2026-11-08T10:00:00.000Z')).toBe('2026-11-02') // a Sunday → that week's Monday
    expect(weekOf('2026-11-02T00:00:00.000Z')).toBe('2026-11-02')
    expect(weekOf('nope')).toBe('')
  })

  it('measures overlap inflation across heavy runs', () => {
    const run = (at: number, sec: number, scope: 'whole' | 'filtered' = 'whole') =>
      ({ toolUseId: 'x', at: T(at), endAt: T(at + sec), wallMs: sec * 1000, category: 'test', rule: 'vitest', runner: 'vitest', scope, command: 'pnpm test', passed: true, timedOut: false, background: false, reportedMs: null, files: null, tests: null, failed: null, hidden: false, sessionId: 's', ticketKey: 'T', projectKey: 'P', repo: REPO }) as any
    const v = concurrencyView([run(0, 100), run(50, 100), run(1000, 30)])
    expect(v.peak).toBe(2)
    expect(v.inflation).toEqual({ overlappedMs: 100_000, aloneMs: 30_000, overlapped: 2, alone: 1 })
    expect(v.overlapShare).toBeCloseTo(100 / 230, 6)
    expect(concurrencyView([]).points).toEqual([])
    // Many short runs that never overlap all land in one long bucket: the
    // bucket's figure is the true peak in flight (1), not how many touched it.
    const serial = Array.from({ length: 40 }, (_, i) => run(i * 5, 2))
    const s = concurrencyView(serial, 2)
    expect(s.peak).toBe(1)
    expect(Math.max(...s.points.map((p) => p.running))).toBe(1)
    // A run spanning a whole bucket is carried into it.
    const long = concurrencyView([run(0, 100_000), run(50_000, 10)], 10)
    expect(long.points.every((p) => p.running >= 1)).toBe(true)
    expect(long.peak).toBe(2)
  })

  it('focuses a compound command on the segment that ran the verification', () => {
    expect(focusCommand('cd /repo/.worktrees/t-1 && SP=/tmp/x pnpm vitest run tests/a.test.ts 2>&1 | tail -20', 'vitest')).toBe('pnpm vitest run tests/a.test.ts 2>&1')
    expect(focusCommand('D=/tmp/scratch/tick-38; cd $D; npx playwright test e2e/login.spec.ts', 'playwright')).toBe('npx playwright test e2e/login.spec.ts')
    // No runner known: a tool-like segment beats a bare assignment or cd.
    expect(focusCommand('C=app-1; docker exec $C sh -c "npm test"; echo done')).toBe('docker exec $C sh -c "npm test"')
    expect(focusCommand('cd /x')).toBe('cd /x')
    // Loop bodies: the `do` keyword is not part of the command, and the sed is housekeeping.
    expect(focusCommand("for f in a b; do sed 's/x//' $f; pnpm vitest run $f; done", 'vitest')).toBe('pnpm vitest run $f')
    // Separators inside quotes don't split: the -c string and the sed script survive whole.
    expect(focusCommand(`C=app-1; docker exec "$C" sh -c "pkill -f 'vitest'; pnpm vitest run" | sed 's/[0-9;]*m//g'`, 'vitest')).toBe(`docker exec "$C" sh -c "pkill -f 'vitest'; pnpm vitest run"`)
    // A heredoc body is data: the runner after it is what ran.
    expect(focusCommand("cd /wt && cat > v.config.ts <<'EOF'\nimport { defineConfig } from 'vitest/config'\nexport default defineConfig({})\nEOF\npnpm vitest run --config v.config.ts", 'vitest')).toBe('pnpm vitest run --config v.config.ts')
    expect(focusCommand("python3 - <<'EOF'\np='a.test.ts'\nEOF\nnpx vitest run a.test.ts \\\n  --reporter dot", 'vitest')).toBe('npx vitest run a.test.ts --reporter dot')
  })

  it('summarize handles empty and league/compare group correctly', () => {
    expect(summarize([])).toMatchObject({ tickets: 0, medianToCloseMs: null, verificationShare: null, wholeRunsPerTicket: null })
    expect(league({ tickets: [], orchestrations: [], jobs: [] })).toEqual([])
    expect(weekly({ tickets: [], orchestrations: [], jobs: [] })).toEqual([])
    expect(compare([], 'model')).toEqual([])
  })
})

describe('backfill', () => {
  const candidates = [
    { id: 'p1', key: 'PROJ-1', tickets: ['TICK-1', 'TICK-2'] },
    { id: 'p2', key: 'PROJ-2', tickets: ['TICK-5'] },
  ]
  it('recognises every dispatch shape', () => {
    expect(matchPrompt('<command-message>jimplement</command-message>\n<command-name>/jimplement</command-name>\n<command-args>TICK-2 in a worktree. Commit, then open a LOCAL PR</command-args>', candidates)).toMatchObject({ role: 'implement', ticketKey: 'TICK-2', projectKey: 'PROJ-1' })
    expect(matchPrompt('/jorchestrate PROJ-2 — jTicket\'s auto loop, implementing phase: TICK-5, at most 2 in flight, orchestrator 2 of 2', candidates)).toMatchObject({ role: 'orchestrate', projectKey: 'PROJ-2', tickets: ['TICK-5'], orchestrator: 2 })
    expect(matchPrompt('/jslice-report PROJ-1 step=2 from=abc to=def', candidates)).toMatchObject({ role: 'slice-report', projectKey: 'PROJ-1' })
    expect(matchPrompt("/jrunplan PROJ-1 — build PROJ-1 (x)'s run plan.", candidates)).toMatchObject({ role: 'runplan-build' })
    expect(matchPrompt('Write the outcome report for jTicket project PROJ-1 "x": the auto loop has finished', candidates)).toMatchObject({ role: 'outcome-report' })
    expect(matchPrompt('Work these PROJ-1 tickets in this one session, one after another, in this order: TICK-1, TICK-2.', candidates)).toMatchObject({ role: 'batch', tickets: ['TICK-1', 'TICK-2'], projectKey: 'PROJ-1' })
    expect(matchPrompt('Merge sweep for PROJ-1: land every open local PR (PR-3, PR-4) on the integration branch', candidates)).toMatchObject({ role: 'merge', projectKey: 'PROJ-1' })
    expect(matchPrompt('Please look at TICK-9 which is not ours', candidates)).toBeNull()
    expect(matchPrompt('I am running proj 4 and 6 right now in parallel', candidates)).toBeNull()
  })

  it('infers the loop from the auto history', () => {
    const p = project('p1', 'PROJ-1', { auto: { history: [{ loop: 1, startedAt: T(0), endedAt: T(100) }, { loop: 2, startedAt: T(200), endedAt: T(300) }] } as any })
    expect(loopAt(p, T(50))).toBe(1)
    expect(loopAt(p, T(250))).toBe(2)
    expect(loopAt(p, T(150))).toBe(0)
  })

  it('adds ledger rows for matched transcripts once', async () => {
    saveSessions([])
    const bdir = join(root, cwdSlug('/bf'))
    new TranscriptBuilder('bf-impl', '/bf').prompt(T(0), '/jimplement TICK-7 in a worktree').assistant(T(1), { text: 'hi', usage: { output_tokens: 1 } }).write(bdir)
    new TranscriptBuilder('bf-chat', '/bf').prompt(T(0), 'what does this file do?').assistant(T(1), { text: 'hi' }).write(bdir)
    new TranscriptBuilder('bf-wt', '/bf/.worktrees/x').prompt(T(0), '/jorchestrate PROJ-7 implementing phase: TICK-7').assistant(T(1), { text: 'hi', model: 'claude-fable-5-2', usage: { output_tokens: 1 } }).write(join(root, cwdSlug('/bf/.worktrees/x')))
    const st = store({ projects: [project('p7', 'PROJ-7', { repo: '/bf' })], tickets: [ticket('t7', 'TICK-7', 'p7')] })
    const r1 = await backfillSessions(st)
    expect(r1).toMatchObject({ scanned: 3, added: 2, skipped: { known: 0, unmatched: 1, unreadable: 0 }, byRole: { implement: 1, orchestrate: 1 } })
    const rows = loadSessions()
    expect(rows.find((s) => s.id === 'bf-impl')).toMatchObject({ role: 'implement', ticketKey: 'TICK-7', projectKey: 'PROJ-7', source: 'backfill', model: 'claude-opus-5-5', dispatchedAt: T(0) })
    expect(rows.find((s) => s.id === 'bf-wt')).toMatchObject({ role: 'orchestrate', tickets: ['TICK-7'], cwd: '/bf/.worktrees/x', model: 'claude-fable-5-2' })
    const r2 = await backfillSessions(st)
    expect(r2).toMatchObject({ added: 0, skipped: { known: 2 } })
  })
})
