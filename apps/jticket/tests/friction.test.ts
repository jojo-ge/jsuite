// Friction, read off a transcript (server/utils/friction.ts): which tool calls
// failed and why, what jTicket's API refused, what was typed into the session.
import { describe, expect, it } from 'vitest'
import { TranscriptBuilder, T } from './fixtures/transcript'
import { parseTranscript } from '../server/utils/transcripts'
import { apiErrorsOf, classifyToolError, frictionOf, mergeFriction } from '../server/utils/friction'

const parse = (b: TranscriptBuilder) => parseTranscript(b.text(), { id: b.sessionId, path: `/x/${b.sessionId}.jsonl` })
const call = (name: string, input: Record<string, unknown>, resultText: string) => ({ id: 'c', at: T(0), name, input, resultText })

describe('classifyToolError', () => {
  it.each([
    ['denied', 'Bash', 'Permission for this action was denied by the Claude Code auto mode classifier'],
    ['edit-unread', 'Edit', '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>'],
    ['edit-miss', 'Edit', '<tool_use_error>String to replace not found in file.\nString: <<<<<<< HEAD</tool_use_error>'],
    ['edit-miss', 'Edit', 'Found 3 matches of the string to replace, but replace_all is false'],
    ['file-missing', 'Read', 'File does not exist. Note: your current working directory is /repo'],
    ['too-large', 'Read', 'File content (671.1KB) exceeds maximum allowed size (256KB). Use offset'],
    ['timeout', 'Bash', 'Command timed out after 2m 0s'],
    ['command-missing', 'Bash', 'Exit code 127\nzsh: command not found: pnpmm'],
    ['api', 'Bash', 'Exit code 1\njt: POST /api/projects/PROJ/auto/claim -> 409 TICK-3 is blocked by TICK-2'],
    ['git', 'Bash', 'Exit code 128\nfatal: not a git repository'],
    ['exit', 'Bash', 'Exit code 5\njq: parse error: Invalid numeric literal at line 1'],
    ['other', 'mcp__playwright__browser_click', '### Error\nError: strict mode violation'],
  ])('%s', (cls, name, text) => {
    expect(classifyToolError(call(name, {}, text))).toBe(cls)
  })
})

describe('apiErrorsOf', () => {
  it("reads jt's error line, and Nitro's error body after a curl", () => {
    expect(apiErrorsOf(call('Bash', { command: 'jt post /api/prs @pr.json' }, 'jt: POST /api/prs -> 400 ticket TICK-9 has no branch'))).toEqual([
      { at: T(0), callId: 'c', method: 'POST', path: '/api/prs', status: 400, message: 'ticket TICK-9 has no branch' },
    ])
    const curl = call('Bash', { command: `curl -s -X PUT http://localhost:43000/api/projects/PROJ/run-plan -d @plan.json` }, '{"error":true,"url":"…","statusCode":409,"statusMessage":"the plan is running","message":"the plan is running"}')
    expect(apiErrorsOf(curl)).toEqual([{ at: T(0), callId: 'c', method: 'PUT', path: '/api/projects/PROJ/run-plan', status: 409, message: 'the plan is running' }])
  })

  it('leaves alone a curl elsewhere, a 200, and other tools', () => {
    expect(apiErrorsOf(call('Bash', { command: 'curl https://example.com/api/x' }, '{"statusCode":404}'))).toEqual([])
    expect(apiErrorsOf(call('Bash', { command: 'curl -s localhost:43000/api/projects' }, '[{"key":"PROJ"}]'))).toEqual([])
    expect(apiErrorsOf(call('Read', { file_path: '/x' }, 'jt: GET /api/x -> 404 nope'))).toEqual([])
  })
})

describe('frictionOf', () => {
  const session = () =>
    new TranscriptBuilder('s1', '/repo')
      .prompt(T(0), 'Implement TICK-7 with the jimplement skill')
      .assistant(T(1), { tools: [{ id: 'r1', name: 'Read', input: { file_path: '/repo/src/a.ts' } }, { id: 'r2', name: 'Read', input: { file_path: '/repo/src/missing.ts' } }, { id: 'g1', name: 'Grep', input: { pattern: 'foo' } }] })
      .result(T(2), 'r1', 'export const a = 1')
      .result(T(2), 'r2', 'File does not exist. Note: your current working directory is /repo', { isError: true })
      .result(T(2), 'g1', 'src/a.ts')
      .assistant(T(3), { tools: [{ id: 'e1', name: 'Edit', input: { file_path: '/repo/src/b.ts', old_string: 'x', new_string: 'y' } }] })
      .result(T(4), 'e1', '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>', { isError: true })
      .assistant(T(5), { tools: [{ id: 'r3', name: 'Read', input: { file_path: '/repo/src/a.ts' } }, { id: 'r4', name: 'Read', input: { file_path: '/repo/src/a.ts' } }] })
      .result(T(6), 'r3', 'export const a = 1')
      .result(T(6), 'r4', 'export const a = 1')
      .assistant(T(7), { tools: [{ id: 't1', name: 'Bash', input: { command: 'pnpm test' } }] })
      .result(T(20), 't1', 'Exit code 1\n Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed (12)\n', { isError: true })
      .assistant(T(21), { tools: [{ id: 'j1', name: 'Bash', input: { command: 'jt post /api/prs @pr.json' } }] })
      .result(T(22), 'j1', 'jt: POST /api/prs -> 400 ticket TICK-7 has no branch', { isError: true })
      .assistant(T(23), { tools: [{ id: 'b1', name: 'Bash', input: { command: 'git status' } }, { id: 'b2', name: 'Bash', input: { command: 'git  status' } }, { id: 'b3', name: 'Bash', input: { command: 'git status' } }] })
      .result(T(24), 'b1', 'clean')
      .result(T(24), 'b2', 'clean')
      .result(T(24), 'b3', 'clean')
      .assistant(T(25), { tools: [{ id: 's1', name: 'Bash', input: { command: 'pnpm install' } }, { id: 'u1', name: 'Bash', input: { command: 'sleep 999' } }] })
      .result(T(25 + 180), 's1', 'Done in 3m')

  it('counts failures by class and tool, keeps their text, and holds failed tests apart', () => {
    const f = frictionOf(parse(session()))
    expect(f.toolCalls).toBe(13)
    expect(f.toolErrors).toBe(3)
    expect(f.verificationFailures).toBe(1)
    expect(f.byClass).toMatchObject({ 'file-missing': 1, 'edit-unread': 1, api: 1, exit: 0 })
    expect(f.byTool).toEqual({ Read: 1, Edit: 1, Bash: 1 })
    expect(f.samples.map((s) => [s.tool, s.class, s.subject])).toEqual([
      ['Read', 'file-missing', '/repo/src/missing.ts'],
      ['Edit', 'edit-unread', '/repo/src/b.ts'],
      ['Bash', 'api', 'jt post /api/prs @pr.json'],
    ])
    expect(f.samples[1]!.text).toContain('File has not been read yet')
    expect(f.apiErrors).toMatchObject([{ method: 'POST', path: '/api/prs', status: 400, message: 'ticket TICK-7 has no branch' }])
  })

  it('reads: how many, how many before the first edit, and which files most', () => {
    const f = frictionOf(parse(session()))
    expect(f.reads).toEqual({ calls: 4, files: 2, beforeFirstEdit: 2, reread: 1, overflow: 0, top: [{ path: 'src/a.ts', count: 3 }, { path: 'src/missing.ts', count: 1 }] })
    expect(f.searches).toBe(1)
  })

  it('finds commands run over and over, slow calls, and calls that never returned', () => {
    const f = frictionOf(parse(session()))
    expect(f.repeatedCommands).toEqual([{ command: 'git status', count: 3 }])
    expect(f.slowCalls).toEqual([{ at: T(25), tool: 'Bash', subject: 'pnpm install', ms: 180_000 }])
    expect(f.unfinishedCalls).toBe(1)
  })

  it("tells the watchdog's nudge from a human typing, and neither from the dispatch prompt", () => {
    const b = new TranscriptBuilder('s2')
      .prompt(T(0), 'Implement TICK-7')
      .assistant(T(5), { text: 'Should I also rename the file?' })
      .userText(T(400), "jTicket's auto loop is still waiting on TICK-7, which is not done. Finish it now: …")
      .userText(T(401), '<system-reminder>ignore me</system-reminder>')
      .assistant(T(410), { text: 'ok' })
      .userText(T(900), 'no — keep the old name, and stop touching the migration')
      .userText(T(905), 'Base directory for this skill: /Users/x/.claude/skills/jimplement\n# jImplement')
      .userText(T(910), 'Another Claude session sent a message: <agent-message from="a30e">[Subagent] done</agent-message>')
      .userText(T(915), 'The coordinator sent a message while you were working: spec check passed')
      .userText(T(920), '[Request interrupted by user]')
    const f = frictionOf(parse(b))
    expect(f.interventions.map((i) => [i.kind, i.at])).toEqual([
      ['nudge', T(400)],
      ['human', T(900)],
      ['interrupt', T(920)],
    ])
    expect(f.interventions[1]!.text).toContain('keep the old name')
    expect([f.nudges, f.humanTurns, f.agentMessages]).toEqual([1, 2, 2])
  })

  it('counts a file once across worktrees, and holds spilled tool results apart', () => {
    const b = new TranscriptBuilder('s5', '/repo')
      .prompt(T(0), 'go')
      .assistant(T(1), {
        tools: [
          { id: 'a', name: 'Read', input: { file_path: '/repo/.worktrees/tick-9/src/a.ts' } },
          { id: 'b', name: 'Read', input: { file_path: '/repo/src/a.ts' } },
          { id: 'c', name: 'Read', input: { file_path: '/Users/x/.claude/projects/-repo/abc-123/tool-results/b3a5.txt' } },
        ],
      })
      .result(T(2), 'a', 'x')
      .result(T(2), 'b', 'x')
      .result(T(2), 'c', 'x')
    expect(frictionOf(parse(b)).reads).toMatchObject({ calls: 3, files: 1, overflow: 1, top: [{ path: 'src/a.ts', count: 2 }] })
  })

  it("takes a refused call's path from Nitro's error body when the command chains several", () => {
    const c = call('Bash', { command: 'curl -s localhost:43000/api/docs; curl -s localhost:43000/api/docs/nope' }, '[]\n{"error":true,"url":"http://localhost:43000/api/docs/nope","statusCode":404,"statusMessage":"Page not found: /api/docs/nope"}')
    expect(apiErrorsOf(c)).toMatchObject([{ method: 'GET', path: '/api/docs/nope', status: 404 }])
    expect(classifyToolError(call('Bash', {}, '<tool_use_error>Blocked: sleep 90 followed by: cat x</tool_use_error>'))).toBe('denied')
  })

  it('counts context compactions', () => {
    const b = new TranscriptBuilder('s3').prompt(T(0), 'go').assistant(T(1), { text: 'working' })
    b.lines.push(JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: T(2) }))
    expect(frictionOf(parse(b)).compactions).toBe(1)
  })

  it('merges sessions: counts add, samples and interventions stay in time order', () => {
    const a = frictionOf(parse(session()))
    const b = frictionOf(
      parse(
        new TranscriptBuilder('s4', '/repo')
          .prompt(T(-60), 'spec check TICK-7')
          .assistant(T(-50), { tools: [{ id: 'x1', name: 'Read', input: { file_path: '/repo/src/a.ts' } }, { id: 'x2', name: 'Bash', input: { command: 'nope' } }] })
          .result(T(-49), 'x1', 'export const a = 1')
          .result(T(-49), 'x2', 'Exit code 127\nzsh: command not found: nope', { isError: true }),
      ),
    )
    const m = mergeFriction([a, b])
    expect(m.toolErrors).toBe(4)
    expect(m.byClass['command-missing']).toBe(1)
    expect(m.byTool.Bash).toBe(2)
    expect(m.samples[0]!.class).toBe('command-missing')
    expect(m.reads.top[0]).toEqual({ path: 'src/a.ts', count: 4 })
    expect(m.reads.calls).toBe(5)
  })
})
