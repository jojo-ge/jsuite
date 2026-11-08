// The passive analytics pipeline: claude's transcript → tool calls, usage,
// subagents (transcripts.ts) → verification runs (verification.ts) →
// checkpoints and cost (sessionMetrics.ts), priced by pricing.ts.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TranscriptBuilder, T } from './fixtures/transcript'
import { findTranscriptPath, parseTranscript, readTranscript, cwdSlug } from '../server/utils/transcripts'
import { classifyVerification, commandVerb, compileRules, parseRunnerOutput, DEFAULT_VERIFICATION_RULES } from '../server/utils/verification'
import { classifySubagent, concurrencyOf, metricsOf, sessionReport } from '../server/utils/sessionMetrics'
import { DEFAULT_PRICES, priceFor, priceUsage } from '../server/utils/pricing'
import { loadSessions, recordSession, sessionRow, sessionsForTicket } from '../server/utils/sessions'

const VITEST_OK = '\n Test Files  3 passed (3)\n      Tests  12 passed (12)\n   Start at  10:00:01\n   Duration  2.40s\n'
const VITEST_ONE = '\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration  0.80s\n'
const VITEST_FAIL = '\n Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed (12)\n   Duration  3.10s\n'

describe('parseTranscript', () => {
  it('reads tool calls with their wall time, dedupes streamed usage, and skips harness noise', () => {
    const b = new TranscriptBuilder('s1')
      .noise()
      .prompt(T(0), 'Implement TICK-7 with the jimplement skill')
      .assistant(T(2), { tools: [{ id: 'c1', name: 'Bash', input: { command: 'pnpm test' } }], usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 200, thinking: 50, ttl: '1h' }, repeat: 3 })
      .result(T(14), 'c1', VITEST_OK)
      .assistant(T(16), { text: 'done', usage: { input_tokens: 5, output_tokens: 20 } })
    const t = parseTranscript(b.text(), { id: 's1', path: '/x/s1.jsonl' })
    expect(t.cwd).toBe('/repo')
    expect(t.startedAt).toBe(T(0))
    expect(t.endedAt).toBe(T(16))
    expect(t.firstPrompt).toContain('TICK-7')
    expect(t.toolCalls).toHaveLength(1)
    expect(t.toolCalls[0]).toMatchObject({ id: 'c1', name: 'Bash', at: T(2), resultAt: T(14), durationMs: 12_000, isError: false, background: false })
    expect(t.toolCalls[0]!.resultText).toContain('Test Files')
    // Three streamed lines of one message count once.
    expect(t.usage).toEqual([
      { model: 'claude-opus-5-5', messages: 2, input: 15, cacheWrite5m: 0, cacheWrite1h: 1000, cacheWriteOther: 0, cacheRead: 5000, output: 220, thinking: 50 },
    ])
    expect(t.badLines).toBe(0)
  })

  it('closes a background Bash call on its task notification and tells human turns from injected ones', () => {
    const b = new TranscriptBuilder('s2')
      .prompt(T(0), 'go')
      .assistant(T(1), { tools: [{ id: 'bg', name: 'Bash', input: { command: 'pnpm test', run_in_background: true } }] })
      .result(T(1.2), 'bg', 'Command running in background with ID: abc. Output is being written to: /tmp/abc.output')
      .assistant(T(2), { text: 'waiting' })
      .notification(T(40), 'bg')
      .userText(T(41), '<system-reminder>ignore me</system-reminder>')
      .userText(T(300), 'looks good, ship it')
    const t = parseTranscript(b.text(), { id: 's2', path: '' })
    expect(t.toolCalls[0]).toMatchObject({ background: true, resultAt: T(40), durationMs: 39_000 })
    expect(t.turns.map((x) => x.kind)).toEqual(['human', 'notification', 'human'])
  })

  it('counts a torn last line as bad, not fatal', () => {
    const text = new TranscriptBuilder('s3').prompt(T(0), 'x').text() + '{"type":"assistant","timest'
    expect(parseTranscript(text, { id: 's3', path: '' }).badLines).toBe(1)
  })
})

describe('readTranscript + subagents', () => {
  const root = mkdtempSync(join(tmpdir(), 'jt-transcripts-'))
  const prev = process.env.CLAUDE_PROJECTS_DIR
  beforeAll(() => {
    process.env.CLAUDE_PROJECTS_DIR = root
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.CLAUDE_PROJECTS_DIR
    else process.env.CLAUDE_PROJECTS_DIR = prev
  })

  it('finds a session by id across project dirs and links subagents to the Agent call that launched them', async () => {
    const parent = new TranscriptBuilder('orch-1', '/repo')
      .prompt(T(0), '/jorchestrate PROJ-1')
      .assistant(T(5), {
        tools: [
          { id: 'a1', name: 'Agent', input: { description: 'implement TICK-7', prompt: 'You are implementing TICK-7. Invoke the jimplement skill with this hand-off: …', model: 'opus' } },
          { id: 'a2', name: 'Agent', input: { description: 'implement TICK-8', prompt: 'You are implementing TICK-8. Invoke the jimplement skill …', model: 'opus' } },
        ],
        usage: { input_tokens: 100, output_tokens: 300 },
        model: 'claude-fable-5-1',
      })
      .result(T(5.5), 'a1', 'Async agent launched successfully.\nagentId: aaa111 (internal)', { toolUseResult: { isAsync: true, agentId: 'aaa111', prompt: '…' } })
      .result(T(5.6), 'a2', 'Async agent launched successfully.\nagentId: bbb222 (internal)', { toolUseResult: { isAsync: true, agentId: 'bbb222', prompt: '…' } })
      .assistant(T(400), { tools: [{ id: 'a3', name: 'Agent', input: { description: 'spec check', prompt: 'Spec-review TICK-7. Diff: … End with VERDICT: PASS or VERDICT: FAIL', model: 'opus' } }], usage: { input_tokens: 50, output_tokens: 100 }, model: 'claude-fable-5-1' })
      .result(T(400.5), 'a3', 'launched', { toolUseResult: { isAsync: true, agentId: 'ccc333' } })
    const impl7 = new TranscriptBuilder('orch-1', '/repo/.worktrees/slot-1')
      .prompt(T(6), 'You are implementing TICK-7…')
      .assistant(T(10), { tools: [{ id: 'e1', name: 'Edit', input: { file_path: 'a.ts' } }], usage: { input_tokens: 1000, output_tokens: 500 } })
      .result(T(10.5), 'e1', 'ok')
      .assistant(T(20), { tools: [{ id: 't1', name: 'Bash', input: { command: 'pnpm vitest run tests/a.test.ts' } }], usage: { output_tokens: 10 } })
      .result(T(30), 't1', VITEST_ONE)
      .assistant(T(200), { text: 'PR-9 opened', usage: { output_tokens: 10 } })
    const impl8 = new TranscriptBuilder('orch-1', '/repo/.worktrees/slot-2')
      .prompt(T(6), 'You are implementing TICK-8…')
      .assistant(T(100), { text: 'done', usage: { input_tokens: 10, output_tokens: 10 } })
    const spec7 = new TranscriptBuilder('orch-1', '/repo').prompt(T(401), 'Spec-review TICK-7').assistant(T(450), { text: 'VERDICT: PASS', usage: { output_tokens: 40 } })
    const dir = join(root, cwdSlug('/repo'))
    parent.write(dir, [
      { agentId: 'aaa111', toolUseId: 'a1', builder: impl7 },
      { agentId: 'bbb222', toolUseId: 'a2', builder: impl8 },
      { agentId: 'ccc333', toolUseId: 'a3', builder: spec7 },
    ])

    expect(findTranscriptPath('orch-1')).toBe(join(dir, 'orch-1.jsonl'))
    expect(findTranscriptPath('nope')).toBeNull()
    const t = (await readTranscript(join(dir, 'orch-1.jsonl')))!
    expect(t.subagents.map((s) => s.agentId)).toEqual(['aaa111', 'bbb222', 'ccc333'])
    expect(t.subagents[0]).toMatchObject({ parentToolUseId: 'a1', description: 'implement TICK-7', requestedModel: 'opus', cwd: '/repo/.worktrees/slot-1' })
    expect(t.subagents[0]!.prompt).toContain('jimplement')

    const report = sessionReport(t, { prices: DEFAULT_PRICES, ticketKeys: ['TICK-7', 'TICK-8'] })
    expect(report.subagents.map((s) => [s.ticketKey, s.role])).toEqual([
      ['TICK-7', 'implement'],
      ['TICK-8', 'implement'],
      ['TICK-7', 'spec-check'],
    ])
    expect(report.subagents[0]).toMatchObject({ firstEditAt: T(10), edits: 1 })
    expect(report.subagents[0]!.verification).toMatchObject({ count: 1, filtered: 1, whole: 0, wallMs: 10_000 })
    // Orchestrator (Fable) + subagents (Opus), summed by model.
    expect(report.totalCost.lines.map((l) => l.model).sort()).toEqual(['claude-fable-5-1', 'claude-opus-5-5'])
    expect(report.totalCost.usd).toBeCloseTo(report.session.cost.usd + report.subagents.reduce((a, s) => a + s.cost.usd, 0), 10)
    // Two implementers overlapped (6s → 100s), the spec check ran alone.
    expect(report.concurrency.max).toBe(2)
    // Cached by size+mtime: the same object comes back.
    expect(await readTranscript(join(dir, 'orch-1.jsonl'))).toBe(t)
  })
})

describe('verification', () => {
  const rules = compileRules(DEFAULT_VERIFICATION_RULES)
  const call = (command: string, resultText = '', over: Partial<Parameters<typeof classifyVerification>[0]> = {}) =>
    classifyVerification({ id: 'x', name: 'Bash', input: { command }, at: T(0), resultAt: T(10), durationMs: 10_000, isError: false, resultText, background: false, agentId: '', ...over }, rules)

  it('strips cd prefixes and env assignments before matching', () => {
    expect(commandVerb('cd /repo && FOO=1 pnpm test')).toBe('pnpm test')
  })

  it('tells a whole vitest run from a filtered one, by command and by output', () => {
    expect(call('pnpm test', VITEST_OK)).toMatchObject({ category: 'test', runner: 'vitest', scope: 'whole', passed: true, files: 3, tests: 12, reportedMs: 2400, wallMs: 10_000 })
    expect(call('pnpm vitest run tests/a.test.ts', VITEST_ONE)).toMatchObject({ scope: 'filtered', files: 1 })
    expect(call('npx vitest run -t "persists"', VITEST_OK)).toMatchObject({ scope: 'filtered' })
    // No path on the command line, but the output says one file ran.
    expect(call('pnpm test', VITEST_ONE)).toMatchObject({ scope: 'filtered' })
    expect(call('pnpm test', VITEST_FAIL)).toMatchObject({ passed: false, failed: 2 })
  })

  it('classifies the other runners', () => {
    expect(call('pytest -k cart', '===== 4 passed, 1 failed in 2.10s =====')).toMatchObject({ category: 'test', runner: 'pytest', scope: 'filtered', failed: 1, passed: false, reportedMs: 2100 })
    expect(call('pnpm exec playwright test', 'Running 12 tests using 4 workers\n\n  12 passed (1.5m)')).toMatchObject({ category: 'e2e', runner: 'playwright', scope: 'whole', tests: 12, reportedMs: 90_000 })
    expect(call('pnpm eslint .', '✖ 3 problems (2 errors, 1 warning)', { isError: true })).toMatchObject({ category: 'lint', runner: 'eslint', failed: 2, passed: false })
    expect(call('pnpm vue-tsc --noEmit', 'Found 0 errors.')).toMatchObject({ category: 'typecheck', passed: true })
    expect(call('bin/check', 'all 28 guards green')).toMatchObject({ category: 'guards', runner: 'bin/check', scope: 'whole' })
    expect(call('vitest run -c vitest.e2e.config.ts', VITEST_OK)).toMatchObject({ category: 'e2e' })
  })

  it('marks timeouts and leaves plain commands alone', () => {
    expect(call('pnpm test', 'Command timed out after 2m 0.0s')).toMatchObject({ timedOut: true, passed: false })
    expect(call('git status')).toBeNull()
    expect(call('ls tests/')).toBeNull()
  })

  it('surfaces verification hidden in a slow or hook-printed commit', () => {
    expect(call('git commit -m "x"', 'ok', { durationMs: 1000 })).toBeNull()
    expect(call('git commit -m "x"', '[main abc] x', { durationMs: 20_000 })).toMatchObject({ hidden: true, category: 'guards' })
    expect(call('git commit -m "x"', 'husky > pre-commit\n Test Files  3 passed (3)\n Duration 4.0s', { durationMs: 6000 })).toMatchObject({ hidden: true, category: 'test', runner: 'vitest' })
  })

  it('parses runner summaries', () => {
    expect(parseRunnerOutput('Test Suites: 1 failed, 3 passed, 4 total\nTests: 2 failed, 40 passed, 42 total\nTime: 3.2 s')).toMatchObject({ runner: 'jest', files: 4, tests: 42, failed: 2, durationMs: 3200 })
    expect(parseRunnerOutput('nothing here').runner).toBe('')
  })
})

describe('metricsOf', () => {
  const opts = { prices: DEFAULT_PRICES }

  it('finds coding start, the PR, verification totals and human wait', () => {
    const b = new TranscriptBuilder('m1')
      .prompt(T(0), 'Implement TICK-7')
      .assistant(T(5), { tools: [{ id: 'r1', name: 'Read', input: { file_path: 'a.ts' } }], usage: { input_tokens: 2000, cache_read_input_tokens: 30000, output_tokens: 100 } })
      .result(T(5.2), 'r1', 'contents')
      .assistant(T(60), { tools: [{ id: 'w1', name: 'Bash', input: { command: "sed -i '' 's/a/b/' a.ts" } }], usage: { output_tokens: 50 } })
      .result(T(60.5), 'w1', '')
      .assistant(T(90), { tools: [{ id: 't1', name: 'Bash', input: { command: 'pnpm test' } }], usage: { output_tokens: 50 } })
      .result(T(150), 't1', VITEST_OK)
      .assistant(T(160), { tools: [{ id: 't2', name: 'Bash', input: { command: 'pnpm test' } }], usage: { output_tokens: 50 } })
      .result(T(220), 't2', VITEST_OK)
      .assistant(T(230), { tools: [{ id: 'g1', name: 'Bash', input: { command: 'git add -A && git commit -m "TICK-7 feat"' } }], usage: { output_tokens: 50 } })
      .result(T(231), 'g1', '[tick/TICK-7 abc] TICK-7 feat')
      .assistant(T(240), { tools: [{ id: 'p1', name: 'Bash', input: { command: 'jt post /api/prs @pr.json' } }], usage: { output_tokens: 50 } })
      .result(T(242), 'p1', '{"key":"PR-9"}')
      .assistant(T(245), { text: 'Done — PR-9', usage: { output_tokens: 80 } })
      .userText(T(900), 'thanks, also rename the flag')
      .assistant(T(905), { text: 'renamed', usage: { output_tokens: 30 } })
    const m = metricsOf(parseTranscript(b.text(), { id: 'm1', path: '' }), opts)
    expect(m).toMatchObject({ durationMs: 905_000, firstToolAt: T(5), firstEditAt: T(60), firstCommitAt: T(230), prOpenedAt: T(242), edits: 1, commits: 1, toolCalls: 6, humanTurns: 2 })
    expect(m.humanWaitMs).toBe(655_000) // 245s → 900s
    expect(m.verification).toMatchObject({ count: 2, whole: 2, wholeMs: 120_000, filtered: 0, repeated: 1, failed: 0, firstAt: T(90), lastAt: T(160) })
    expect(m.verification.byCategory.test).toEqual({ count: 2, wallMs: 120_000 })
    // 2000 in × $4 + 30000 cache read × $0.20 + 460 out × $20, per MTok.
    expect(m.cost.usd).toBeCloseTo((2000 * 4 + 30000 * 0.2 + 460 * 20) / 1e6, 9)
    expect(m.cost.cacheReadRatio).toBeCloseTo(30000 / 32000, 6)
    expect(m.cost.unpriced).toEqual([])
  })

  it('flags an unknown model as unpriced rather than guessing', () => {
    const b = new TranscriptBuilder('m2', '/repo', 'claude-future-9').prompt(T(0), 'x').assistant(T(1), { usage: { output_tokens: 10 } })
    const m = metricsOf(parseTranscript(b.text(), { id: 'm2', path: '' }), opts)
    expect(m.cost).toMatchObject({ usd: 0, unpriced: ['claude-future-9'] })
  })
})

describe('classifySubagent / concurrencyOf', () => {
  it('reads role and ticket from the brief, preferring the orchestrator’s own tickets', () => {
    expect(classifySubagent({ description: '', prompt: 'You are implementing TICK-7 (blocked by TICK-3 earlier). Invoke the jimplement skill' }, ['TICK-7'])).toEqual({ role: 'implement', ticketKey: 'TICK-7' })
    expect(classifySubagent({ description: 'spec', prompt: 'Spec-review TICK-8. … VERDICT: PASS or VERDICT: FAIL' })).toEqual({ role: 'spec-check', ticketKey: 'TICK-8' })
    expect(classifySubagent({ description: 'Explore', prompt: 'Find every caller of foo' })).toEqual({ role: 'other', ticketKey: '' })
    // An implementer brief that goes on to describe the spec check awaiting it is still an implementer.
    expect(
      classifySubagent({
        description: 'Audit TICK-5 usage report',
        prompt: 'You are implementing TICK-5, a READ-ONLY audit ticket. Change no file. A spec check follows and will answer VERDICT: PASS or VERDICT: FAIL on your report.',
      }),
    ).toEqual({ role: 'implement', ticketKey: 'TICK-5' })
    expect(classifySubagent({ description: 'Spec-review TICK-5 report doc', prompt: 'Spec-review TICK-5, a READ-ONLY audit ticket. There is no diff and no PR.' })).toEqual({ role: 'spec-check', ticketKey: 'TICK-5' })
  })
  it('measures peak and mean overlap', () => {
    const c = concurrencyOf([
      { startedAt: T(0), endedAt: T(100) },
      { startedAt: T(50), endedAt: T(150) },
      { startedAt: T(200), endedAt: T(250) },
    ])
    expect(c.max).toBe(2)
    expect(c.mean).toBeCloseTo((100 + 100 + 50) / 250, 6)
  })
})

describe('pricing', () => {
  it('matches dated and suffixed ids by prefix', () => {
    expect(priceFor('claude-opus-5-5-20260401')).toEqual(DEFAULT_PRICES['claude-opus-5-5'])
    expect(priceFor('claude-opus-5')).toEqual(DEFAULT_PRICES['claude-opus-5'])
    expect(priceFor('claude-opus-5-5[1m]')).toEqual(DEFAULT_PRICES['claude-opus-5-5'])
    expect(priceFor('gpt-x')).toBeNull()
  })
  it('prices cache writes by TTL', () => {
    const u = { model: 'claude-sonnet-5-5', messages: 1, input: 0, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, cacheWriteOther: 0, cacheRead: 0, output: 0, thinking: 0 }
    expect(priceUsage(u).usd).toBeCloseTo(2 * 1.25 + 2 * 2, 9)
  })
})

describe('session ledger', () => {
  it('records, coerces and finds a ticket’s sessions including batches', () => {
    recordSession(sessionRow({ id: 'a', role: 'implement', ticketKey: 'TICK-1', projectId: 'p', projectKey: 'PROJ-1', repo: '/r', cwd: '/r', dispatchedAt: T(0) }))
    recordSession(sessionRow({ id: 'b', role: 'batch', tickets: ['TICK-1', 'TICK-2'], projectId: 'p', projectKey: 'PROJ-1', repo: '/r', cwd: '/r', dispatchedAt: T(10) }))
    recordSession(sessionRow({ id: 'a', role: 'implement', ticketKey: 'TICK-1', projectId: 'p', projectKey: 'PROJ-1', repo: '/r', cwd: '/r', dispatchedAt: T(0), agent: 'ag' }))
    const all = loadSessions()
    expect(all).toHaveLength(2)
    expect(all.find((s) => s.id === 'a')).toMatchObject({ agent: 'ag', tickets: ['TICK-1'], source: 'dispatch', loop: 0 })
    expect(sessionsForTicket(all, 'TICK-1').map((s) => s.id)).toEqual(['b', 'a'])
    expect(sessionsForTicket(all, 'TICK-2').map((s) => s.id)).toEqual(['b'])
  })
})
