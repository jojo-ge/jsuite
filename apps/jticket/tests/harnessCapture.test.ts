// Harness capture end to end, over a throwaway data dir and transcript dir:
// the store's save journals a run (server/utils/runJournal.ts), sessions are
// stamped with the harness they ran under (harnessVersion.ts) and frozen into
// digests, findings are blamed on tickets (findingAttribution.ts), and an
// ended run is snapshotted (harnessCapture.ts).
import { mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TranscriptBuilder, T } from './fixtures/transcript'
import { newAutoLoop, type AutoLoop } from '../app/utils/autoLoop'
import { journalRuns } from '../app/utils/runJournal'
import { coerceRunPlan } from '../app/utils/runPlan'
import type { Finding } from '../app/utils/reviewTypes'
import { attributeFindings, blamedCommit } from '../server/utils/findingAttribution'
import { codebaseSetupId, harnessId, readGitHarnessState, stableJson } from '../server/utils/harnessVersion'
import { journalStoreSave, readJournal, resetJournalState, type JournalProject } from '../server/utils/runJournal'
import { loadSessions, recordSession, sessionRow } from '../server/utils/sessions'
import { loadStore, saveStore } from '../server/utils/store'
import { buildRunSnapshot, captureHarness, freezeSession, readRunSnapshot, readSessionDigest, runPauses, QUIET_MS } from '../server/utils/harnessCapture'

const AT = '2026-11-08T10:00:00.000Z'
const later = (min: number) => new Date(Date.parse(AT) + min * 60_000).toISOString()
const on = (patch: Partial<AutoLoop> = {}): AutoLoop => ({ ...newAutoLoop(AT), enabled: true, ...patch })

describe('harness version', () => {
  it('is a content hash: trees, then +dirty and ~prompts only when there are any', () => {
    const git = { commit: 'abc', trees: ['t1', 't2'], dirty: '' }
    const clean = harnessId(git, {})
    expect(clean).toMatch(/^[0-9a-f]{8}$/)
    expect(harnessId({ ...git, commit: 'a-docs-commit' }, {})).toBe(clean)
    expect(harnessId({ ...git, trees: ['t1', 't3'] }, {})).not.toBe(clean)
    expect(harnessId({ ...git, dirty: 'diff --git a/x b/x' }, {})).toMatch(new RegExp(`^${clean}\\+[0-9a-f]{8}$`))
    expect(harnessId(git, { merge: 'Sweep carefully' })).toMatch(new RegExp(`^${clean}~[0-9a-f]{8}$`))
    expect(harnessId({ commit: '', trees: [], dirty: '' }, {})).toBe('unknown')
  })

  it('hashes equal settings alike however their keys are ordered', () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableJson({ a: [{ c: 2, d: 1 }], b: 1 }))
    const repo = { prompts: {}, worktreeGuide: null, verificationRules: [] }
    expect(codebaseSetupId(undefined)).toBe('')
    expect(codebaseSetupId(repo)).toBe('')
    expect(codebaseSetupId({ ...repo, prompts: { merge: 'x' } })).toMatch(/^[0-9a-f]{8}$/)
  })

  it('reads this checkout', () => {
    const state = readGitHarnessState()
    expect(state.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(state.trees.filter(Boolean).length).toBeGreaterThan(3)
  })

  it('is stamped on a session as it is dispatched, never on a backfilled one', () => {
    recordSession(sessionRow({ id: 'stamp-1', role: 'implement', projectId: 'p', projectKey: 'PROJ', repo: '/repo', cwd: '/repo' }))
    recordSession(sessionRow({ id: 'stamp-2', role: 'implement', projectId: 'p', projectKey: 'PROJ', repo: '/repo', cwd: '/repo', source: 'backfill' }))
    const [a, b] = loadSessions().filter((s) => s.id.startsWith('stamp-'))
    expect(a!.harness).toMatch(/^[0-9a-f]{8}/)
    expect(a!.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect([b!.harness, b!.commit]).toEqual(['', ''])
  })
})

describe('finding attribution', () => {
  const finding = (id: string, patch: Partial<Finding> = {}): Finding => ({ id, title: `finding ${id}`, severity: 'high', category: 'correctness', summary: '', detail: '', reviewers: [1, 2], ...patch })
  const prs = [
    { key: 'PR-1', mergeCommit: 'a'.repeat(40), ticketId: 't1' },
    { key: 'PR-2', mergeCommit: 'b'.repeat(40), ticketId: 't2' },
    { key: 'PR-3', mergeCommit: '', ticketId: 't3' },
  ]
  const tickets = new Map([['t1', 'TICK-1'], ['t2', 'TICK-2'], ['t3', 'TICK-3']])

  it('blames a finding on the ticket whose PR last wrote the line', async () => {
    const blame = async (file: string, line: number | null) =>
      file === 'src/a.ts' ? { commit: 'a'.repeat(40), by: 'line' as const } : file === 'src/b.ts' ? { commit: 'b'.repeat(12), by: 'file' as const } : file === 'src/old.ts' ? { commit: 'c'.repeat(40), by: 'line' as const } : Promise.reject(new Error(`no ${file}:${line}`))
    const out = await attributeFindings(
      [finding('f1', { file: 'src/a.ts', line: 10, ticketKey: 'TICK-9', scope: 'in', verdict: 'confirmed' }), finding('f2', { file: 'src/b.ts' }), finding('f3', { file: 'src/old.ts', line: 3, scope: 'out' }), finding('f4', { file: 'src/gone.ts', line: 1 }), finding('f5')],
      blame,
      prs,
      tickets,
    )
    expect(out.map((f) => [f.findingId, f.by, f.introducedPr, f.introducedBy])).toEqual([
      ['f1', 'line', 'PR-1', 'TICK-1'],
      ['f2', 'file', 'PR-2', 'TICK-2'],
      // Code from before the run: a commit, but nobody's ticket.
      ['f3', 'line', '', ''],
      // git couldn't say; a finding with no file is never asked.
      ['f4', '', '', ''],
      ['f5', '', '', ''],
    ])
    expect(out[0]).toMatchObject({ fixTicket: 'TICK-9', scope: 'in', verdict: 'confirmed', raisedBy: 2, line: 10 })
    expect(out[1]!.line).toBeNull()
  })

  it("reads the commit off blame's porcelain, ignoring an uncommitted line", () => {
    expect(blamedCommit(`${'a'.repeat(40)} 10 10 1\nauthor x\n`)).toBe('a'.repeat(40))
    expect(blamedCommit(`^${'b'.repeat(39)} 1 1 1\n`)).toBe('b'.repeat(39))
    expect(blamedCommit(`${'0'.repeat(40)} 1 1 1\n`)).toBe('')
    expect(blamedCommit('fatal: no such path')).toBe('')
  })
})

describe('the journal on disk', () => {
  beforeEach(() => resetJournalState())
  const project = (auto: AutoLoop | null, id = 'jp1'): JournalProject => ({ id, key: 'PROJ-1', repo: '/repo', auto })

  it('diffs each save against the last, and the first against the file on disk', () => {
    const idle = on()
    // First save after a restart: disk already has the run on, so nothing is news.
    expect(journalStoreSave([project(idle)], () => [project(idle)], later(1))).toEqual([])
    const nudged = { ...idle, phase: 'implementing' as const, watch: { 'T-1': { stoppedSince: later(2), nudgedAt: later(7) } } }
    const lines = journalStoreSave([project(nudged)], () => { throw new Error('read once') }, later(7))
    expect(lines.map((l) => l.kind)).toEqual(['phase', 'ticket-stopped', 'nudged'])
    // A run already going when the journal first saw it still gets one id for all its lines.
    expect(new Set(lines.map((l) => l.runId)).size).toBe(1)
    expect(lines[0]).toMatchObject({ projectId: 'jp1', projectKey: 'PROJ-1', repo: '/repo' })
    expect(journalStoreSave([project(nudged)], () => [], later(8))).toEqual([])
    expect(readJournal().filter((l) => l.projectId === 'jp1')).toHaveLength(3)
  })

  it('names a run at its start and keeps the name across a restart', () => {
    const started = journalStoreSave([project(on(), 'jp2')], () => [project(null, 'jp2')], AT)
    expect(started).toMatchObject([{ kind: 'run-started', runId: 'PROJ-1@20261108T100000Z' }])
    resetJournalState()
    const paused = { ...on(), paused: { reason: 'phase-stalled' as const, detail: 'silent', at: later(50) } }
    const after = journalStoreSave([project(paused, 'jp2')], () => [project(on(), 'jp2')], later(50))
    expect(after).toMatchObject([{ kind: 'paused', runId: 'PROJ-1@20261108T100000Z' }])
    const off: AutoLoop = { ...newAutoLoop(later(60), paused), ended: { reason: 'turned-off', at: later(60) } }
    expect(journalStoreSave([project(off, 'jp2')], () => [], later(60)).map((l) => [l.kind, l.runId])).toEqual([['run-ended', 'PROJ-1@20261108T100000Z']])
    // The next run is a new one.
    expect(journalStoreSave([project(on(), 'jp2')], () => [], later(120))[0]!.runId).toBe('PROJ-1@20261108T120000Z')
  })

  it('never lets a failure reach the save', () => {
    expect(journalStoreSave([project(on(), 'jp3')], () => { throw new Error('disk gone') }, AT)).toEqual([])
  })

  it('is fed by saveStore itself', () => {
    const store = loadStore()
    store.projects.push({ id: 'jp4', key: 'PROJ-4', repo: '/repo', auto: null } as any)
    saveStore(store)
    const before = readJournal().length
    store.projects.at(-1)!.auto = on()
    saveStore(store)
    saveStore(store)
    expect(readJournal().slice(before)).toMatchObject([{ kind: 'run-started', projectKey: 'PROJ-4' }])
  })
})

describe('capture', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'jticket-capture-'))
    process.env.CLAUDE_PROJECTS_DIR = dir
  })
  const store = () => ({ ...loadStore(), projects: [{ id: 'cp1', key: 'PROJ-7', repo: '/repo' } as any], tickets: [ticket('t1', 'TICK-1'), ticket('t2', 'TICK-2', ['auto-loop:carryover'], later(40))], prs: [{ id: 'pr1', key: 'PR-1', ticketId: 't1', projectId: 'cp1', status: 'merged', mergeCommit: 'a'.repeat(40) } as any] })
  const ticket = (id: string, key: string, labels: string[] = [], createdAt = AT) => ({ id, key, title: key, type: 'task', status: 'done', projectId: 'cp1', labels, createdAt, pickedUpAt: later(1), completedAt: later(30) }) as any

  function writeSession(id: string, mtime: Date) {
    const path = new TranscriptBuilder(id, '/repo')
      .prompt(later(1), 'Implement TICK-1 with the jimplement skill')
      .assistant(later(2), { tools: [{ id: 'r1', name: 'Read', input: { file_path: '/repo/src/a.ts' } }, { id: 'j1', name: 'Bash', input: { command: 'jt post /api/prs @pr.json' } }], usage: { input_tokens: 100, output_tokens: 50 } })
      .result(later(3), 'r1', 'export const a = 1')
      .result(later(3), 'j1', 'jt: POST /api/prs -> 400 no branch', { isError: true })
      .userText(later(20), 'use the other branch')
      .assistant(later(21), { text: 'done' })
      .write(join(dir, '-repo'))
    utimesSync(path, mtime, mtime)
    return path
  }

  it('freezes a quiet session once, and again only when its transcript moves on', async () => {
    const now = Date.parse(later(200))
    const row = sessionRow({ id: 'cap-1', role: 'implement', ticketKey: 'TICK-1', projectId: 'cp1', projectKey: 'PROJ-7', repo: '/repo', cwd: '/repo', dispatchedAt: later(1), harness: 'h1' })
    expect(await freezeSession(store(), { ...row, id: 'cap-none' }, now)).toBe('missing')
    writeSession('cap-1', new Date(now - 60_000))
    expect(await freezeSession(store(), row, now)).toBe('live')
    expect(readSessionDigest('cap-1')).toBeNull()
    writeSession('cap-1', new Date(now - QUIET_MS - 1000))
    expect(await freezeSession(store(), row, now)).toBe('frozen')
    expect(await freezeSession(store(), row, now)).toBe('fresh')
    const d = readSessionDigest('cap-1')!
    expect(d.record).toMatchObject({ id: 'cap-1', harness: 'h1' })
    expect(d.friction).toMatchObject({ toolErrors: 1, humanTurns: 1 })
    expect(d.friction.apiErrors).toMatchObject([{ path: '/api/prs', status: 400 }])
    expect(d.report.session.toolCalls).toBe(2)
    // Picked back up later: the file changed, so it is frozen again.
    writeSession('cap-1', new Date(now - QUIET_MS - 500))
    expect(await freezeSession(store(), row, now)).toBe('frozen')
  })

  it('reads pauses off the events, open ones included', () => {
    const line = (kind: any, at: string, data: any = {}, detail = '') => ({ kind, at, data, detail }) as any
    expect(runPauses([line('paused', later(5), { reason: 'merge-incomplete' }, 'PR-3'), line('resumed', later(35), { ms: 1_800_000 }), line('paused', later(50), { reason: 'phase-stalled' }, 'silent')])).toEqual([
      { at: later(5), reason: 'merge-incomplete', detail: 'PR-3', ms: 1_800_000 },
      { at: later(50), reason: 'phase-stalled', detail: 'silent', ms: null },
    ])
  })

  it('snapshots an ended run: events, tickets, sessions and totals', async () => {
    resetJournalState()
    const p = (auto: AutoLoop | null): JournalProject => ({ id: 'cp1', key: 'PROJ-7', repo: '/repo', auto })
    const going = on({ phase: 'implementing', loopStartedAt: later(1), phaseStartedAt: later(1), tickets: ['TICK-1'], dispatched: { 'TICK-1': later(1) } })
    const nudged = { ...going, watch: { 'TICK-1': { stoppedSince: later(10), nudgedAt: later(15) } } }
    const forced = { ...nudged, forced: ['TICK-1'], paused: { reason: 'merge-incomplete' as const, detail: 'PR-1: conflict', at: later(40) } }
    const off: AutoLoop = { ...newAutoLoop(later(60), forced), ended: { reason: 'turned-off', at: later(60) } }
    const plan = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: ['TICK-1'], dispatch: { mode: 'sessions', model: 'sonnet', effort: 'medium', budget: 2, orchestrators: 1 }, predictions: { 'TICK-1': { weight: 'light', minutes: 15, risk: 'low', why: 'one file' } } }] })
    journalStoreSave([p(on({ plan }))], () => [p(null)], AT)
    journalStoreSave([p(going)], () => [], later(1))
    journalStoreSave([p(nudged)], () => [], later(15))
    journalStoreSave([p(forced)], () => [], later(40))
    journalStoreSave([p(off)], () => [], later(60))
    const run = journalRuns(readJournal()).find((r) => r.projectId === 'cp1')!
    expect(run).toMatchObject({ runId: 'PROJ-7@20261108T100000Z', kind: 'plan', endedAt: later(60), endReason: 'turned-off' })

    const rows = [
      sessionRow({ id: 'cap-1', role: 'implement', ticketKey: 'TICK-1', projectId: 'cp1', projectKey: 'PROJ-7', repo: '/repo', cwd: '/repo', dispatchedAt: later(1), harness: 'h1' }),
      sessionRow({ id: 'cap-2', role: 'merge', projectId: 'cp1', projectKey: 'PROJ-7', repo: '/repo', cwd: '/repo', dispatchedAt: later(35), harness: 'h2' }),
      sessionRow({ id: 'cap-other', role: 'implement', projectId: 'cp1', projectKey: 'PROJ-7', repo: '/repo', cwd: '/repo', dispatchedAt: later(300), harness: 'h9' }),
    ]
    const snap = await buildRunSnapshot(store(), run, rows, Date.parse(later(200)))
    expect(snap).toMatchObject({ runId: run.runId, projectKey: 'PROJ-7', endReason: 'turned-off', harness: ['h1', 'h2'], pending: ['cap-2'] })
    expect(snap.sessions.map((s) => [s.id, s.digest])).toEqual([['cap-1', true], ['cap-2', false]])
    expect(snap.pauses).toEqual([{ at: later(40), reason: 'merge-incomplete', detail: 'PR-1: conflict', ms: null }])
    expect(snap.tickets).toMatchObject([
      { key: 'TICK-1', role: 'implement', dispatched: 1, stopped: 1, nudged: 1, forced: true, pr: 'PR-1', prStatus: 'merged' },
      { key: 'TICK-2', role: 'carryover', forced: false },
    ])
    // The builder said 15 minutes on Sonnet medium; picked up at +1, closed at +30.
    expect(snap.tickets[0]).toMatchObject({ planned: { stepId: 's1', model: 'sonnet', effort: 'medium', orchestrated: false, prediction: { weight: 'light', minutes: 15, risk: 'low', why: 'one file' } }, actualMinutes: 29 })
    expect(snap.tickets[1]).toMatchObject({ planned: null })
    expect(snap.totals).toMatchObject({ wallMs: 60 * 60_000, sessions: 2, nudges: 1, forced: 1, pauses: 1, toolErrors: 1, apiErrors: 1, humanTurns: 1, findings: 0 })
    expect(snap.counts).toMatchObject({ 'run-started': 1, dispatched: 1, nudged: 1, forced: 1, paused: 1, 'run-ended': 1 })
  })

  it('captureHarness snapshots ended, settled runs and leaves a complete one alone', async () => {
    recordSession(sessionRow({ id: 'cap-1', role: 'implement', ticketKey: 'TICK-1', projectId: 'cp1', projectKey: 'PROJ-7', repo: '/repo', cwd: '/repo', dispatchedAt: later(1), harness: 'h1' }))
    const now = Date.parse(later(200))
    const first = await captureHarness(store(), { now })
    expect(first.runs.snapshotted).toContain('PROJ-7@20261108T100000Z')
    expect(readRunSnapshot('PROJ-7@20261108T100000Z')).toMatchObject({ pending: [], totals: { sessions: 1 } })
    const second = await captureHarness(store(), { now })
    expect(second.runs.snapshotted).not.toContain('PROJ-7@20261108T100000Z')
    expect(second.sessions.frozen).toBe(0)
  })
})
