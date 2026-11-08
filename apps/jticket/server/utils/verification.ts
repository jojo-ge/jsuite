// Classifying the Bash calls a session made into verification runs — tests,
// end-to-end suites, lint, typecheck, guard scripts, builds — and saying how
// long each took, how broad it was, and whether it passed.
//
// Two layers, output first: a runner's own summary ("Test Files 3 passed
// (3)", "12 passed in 1.4s") is the ground truth for breadth and duration,
// whatever the command line said. The command decides the category and, when
// the output is silent, the breadth: a path, a name pattern or a changed-files
// flag means a filtered run; a bare `pnpm test` means the whole suite.
//
// Rules are data (regex sources), so a codebase can add its own in Codebase
// settings; the defaults cover the usual runners. Everything here is a
// heuristic over command text — reported as such, never as fact.
import type { TranscriptToolCall } from './transcripts'

export type VerificationCategory = 'test' | 'e2e' | 'lint' | 'typecheck' | 'guards' | 'build'
export const VERIFICATION_CATEGORIES: VerificationCategory[] = ['test', 'e2e', 'lint', 'typecheck', 'guards', 'build']

export interface VerificationRule {
  id: string
  category: VerificationCategory
  /** A regex source matched (case-insensitive) against the command with its `cd … &&` prefix stripped. */
  pattern: string
}

export type VerificationScope = 'whole' | 'filtered' | 'unknown'

export interface VerificationRun {
  toolUseId: string
  at: string
  /** Wall time the agent waited (call → result); null when the result never landed. */
  wallMs: number | null
  category: VerificationCategory
  rule: string
  /** Which runner the output or command looked like ('' when unknown). */
  runner: string
  scope: VerificationScope
  command: string
  /** From the exit (is_error) and the runner summary; null when neither said. */
  passed: boolean | null
  timedOut: boolean
  background: boolean
  /** The runner's own duration, when it printed one. */
  reportedMs: number | null
  files: number | null
  tests: number | null
  failed: number | null
  /** Verification that ran inside something else — a pre-commit hook on `git commit`. */
  hidden: boolean
}

/** First match wins, so the specific (e2e, guards) sit above the general (test). */
export const DEFAULT_VERIFICATION_RULES: VerificationRule[] = [
  { id: 'playwright', category: 'e2e', pattern: String.raw`\bplaywright\s+test\b|\btest:e2e\b|\be2e\b.*\btest\b|\bcypress\s+run\b` },
  { id: 'vitest-e2e-config', category: 'e2e', pattern: String.raw`\bvitest\b.*\s-c\s+\S*e2e` },
  { id: 'guards', category: 'guards', pattern: String.raw`(^|[\s/])bin/check(\.ts|\.js|\.mjs)?\b|\bpnpm\s+(run\s+)?check\b|\bnpm\s+run\s+check\b` },
  { id: 'typecheck', category: 'typecheck', pattern: String.raw`\b(vue-)?tsc\b|\bnuxi\s+typecheck\b|\btypecheck\b|\bmypy\b|\bpyright\b` },
  { id: 'lint', category: 'lint', pattern: String.raw`\beslint\b|\bbiome\s+(check|lint)\b|\bruff\s+(check|format)\b|\bprettier\b.*--check|\boxlint\b|\bgolangci-lint\b|\bclippy\b|\bpnpm\s+(run\s+)?lint\b|\bnpm\s+run\s+lint\b` },
  { id: 'build', category: 'build', pattern: String.raw`\bnuxi?\s+build\b|\bnext\s+build\b|\bvite\s+build\b|\bpnpm\s+(run\s+)?build\b|\bnpm\s+run\s+build\b|\bcargo\s+build\b|\bgo\s+build\b` },
  { id: 'vitest', category: 'test', pattern: String.raw`\bvitest\b` },
  { id: 'jest', category: 'test', pattern: String.raw`\bjest\b` },
  { id: 'pytest', category: 'test', pattern: String.raw`\bpytest\b|python[3]?\s+-m\s+pytest\b` },
  { id: 'node-test', category: 'test', pattern: String.raw`\bnode\s+(--test\b|.*--test\b)|\bbun\s+test\b|\bdeno\s+test\b` },
  { id: 'cargo-go', category: 'test', pattern: String.raw`\bcargo\s+test\b|\bgo\s+test\b` },
  { id: 'npm-test', category: 'test', pattern: String.raw`\b(pnpm|npm|yarn|bun)\s+(run\s+)?test(:\w+)?\b` },
]

const FILTER_FLAGS = /(^|\s)(-t|-g|-k|--testNamePattern|--grep|--changed|--related|--only|--filter|--spec|--file)(\s|=|$)/
const PATH_ARG = /(^|\s)(\.\/|\/)?[\w@./-]+\.(test|spec)\.[cm]?[jt]sx?(\s|$)|(^|\s)(\.\/)?[\w./-]*(tests?|__tests__|spec)\/[\w./-]+(\s|$)|(^|\s)(\.\/)?[\w./-]*test_[\w]+\.py(\s|$)/
const TIMEOUT_TEXT = /Command timed out after|\btimed out\b.*\b(after|ms|s)\b|exit code 124\b/i
const COMMIT = /\bgit\b(?:\s+-C\s+\S+)?[^|;&]*\bcommit\b/
const HOOK_MARKERS = /husky|lint-staged|pre-commit|Test Files|Tests:|passed in [\d.]+s|✖ \d+ problems?/
const HIDDEN_COMMIT_MS = 5000

/** Strip `cd x && ` / `cd x; ` prefixes and env assignments so rules see the verb. */
export function commandVerb(command: string): string {
  let c = command.trim()
  for (;;) {
    const m = /^(?:cd\s+\S+\s*(?:&&|;)\s*|[A-Z_][A-Z0-9_]*=\S+\s+)/.exec(c)
    if (!m) break
    c = c.slice(m[0].length)
  }
  return c
}

/** Compile a rule set, dropping any pattern that doesn't compile (a bad codebase override must not break the page). */
export function compileRules(rules: VerificationRule[]): { rule: VerificationRule; re: RegExp }[] {
  const out: { rule: VerificationRule; re: RegExp }[] = []
  for (const rule of rules) {
    try {
      out.push({ rule, re: new RegExp(rule.pattern, 'i') })
    } catch {
      /* skipped */
    }
  }
  return out
}

/**
 * Classify one tool call. Returns null for anything that isn't a Bash
 * verification run (or a commit that hid one).
 */
export function classifyVerification(call: TranscriptToolCall, compiled = compileRules(DEFAULT_VERIFICATION_RULES)): VerificationRun | null {
  if (call.name !== 'Bash') return null
  const command = typeof call.input.command === 'string' ? call.input.command : ''
  if (!command) return null
  const verb = commandVerb(command)
  const output = call.resultText
  const timedOut = TIMEOUT_TEXT.test(output)

  let match = compiled.find(({ re }) => re.test(verb)) ?? null
  let hidden = false
  if (!match && COMMIT.test(verb)) {
    // A slow commit, or one whose output reads like a runner: a hook ran verification.
    const slow = (call.durationMs ?? 0) >= HIDDEN_COMMIT_MS
    if (!(slow || HOOK_MARKERS.test(output))) return null
    const cat = /Test Files|Tests:|passed in [\d.]+s/.test(output) ? 'test' : /eslint|✖ \d+ problems?|lint-staged|prettier/i.test(output) ? 'lint' : 'guards'
    match = { rule: { id: 'pre-commit', category: cat as VerificationCategory, pattern: '' }, re: COMMIT }
    hidden = true
  }
  if (!match) return null

  const summary = parseRunnerOutput(output)
  const runner = summary.runner || runnerFromCommand(verb)
  const errored = call.isError || /\b(FAIL|failed)\b/.test(summary.statusLine ?? '')
  let passed: boolean | null = null
  if (summary.failed !== null) passed = summary.failed === 0 && !call.isError
  else if (call.resultAt) passed = !call.isError && !timedOut
  if (timedOut) passed = false

  let scope: VerificationScope = 'unknown'
  const filteredByCommand = FILTER_FLAGS.test(verb) || PATH_ARG.test(verb)
  if (filteredByCommand) scope = 'filtered'
  else if (match.rule.category === 'test' || match.rule.category === 'e2e') scope = 'whole'
  else scope = 'whole'
  // The output outranks the command: a "whole" run that touched one file was filtered.
  if (scope === 'whole' && summary.files !== null && summary.files <= 1 && (match.rule.category === 'test' || match.rule.category === 'e2e')) scope = 'filtered'

  return {
    toolUseId: call.id,
    at: call.at,
    wallMs: call.durationMs,
    category: match.rule.category,
    rule: match.rule.id,
    runner,
    scope,
    // The segment that ran the verification, not the cd/env/heredoc chain around it (a blind slice loses the runner).
    command: focusCommand(command, runner) || command.slice(0, 300),
    passed: errored && passed === null ? false : passed,
    timedOut,
    background: call.background,
    reportedMs: summary.durationMs,
    files: summary.files,
    tests: summary.tests,
    failed: summary.failed,
    hidden,
  }
}

interface RunnerSummary {
  runner: string
  files: number | null
  tests: number | null
  failed: number | null
  durationMs: number | null
  statusLine: string | null
}

const toMs = (v: string, unit: string) => {
  const x = parseFloat(v)
  if (!Number.isFinite(x)) return null
  return unit === 'ms' ? x : unit === 'm' ? x * 60_000 : x * 1000
}

/** Pull counts and duration out of a runner's summary. Vitest, Jest, pytest, Playwright, ESLint, tsc. */
export function parseRunnerOutput(out: string): RunnerSummary {
  const none: RunnerSummary = { runner: '', files: null, tests: null, failed: null, durationMs: null, statusLine: null }
  if (!out) return none
  // Vitest:  Test Files  1 failed | 3 passed (4)   /   Tests  12 passed (12)   /   Duration  1.23s
  let m = /Test Files\s+([^\n(]*)\((\d+)\)/.exec(out)
  if (m) {
    const files = parseInt(m[2]!, 10)
    const tm = /\n\s*Tests\s+([^\n(]*)\((\d+)\)/.exec(out)
    const failedFiles = /(\d+) failed/.exec(m[1]!)
    const failedTests = tm ? /(\d+) failed/.exec(tm[1]!) : null
    const dm = /Duration\s+([\d.]+)(ms|s|m)\b/.exec(out)
    return {
      runner: 'vitest',
      files,
      tests: tm ? parseInt(tm[2]!, 10) : null,
      failed: failedTests ? parseInt(failedTests[1]!, 10) : failedFiles ? parseInt(failedFiles[1]!, 10) : 0,
      durationMs: dm ? toMs(dm[1]!, dm[2]!) : null,
      statusLine: m[0],
    }
  }
  // Jest:  Test Suites: 1 failed, 3 passed, 4 total   /   Tests: … total   /   Time: 1.2 s
  m = /Test Suites:\s*([^\n]*?)(\d+) total/.exec(out)
  if (m) {
    const tm = /Tests:\s*([^\n]*?)(\d+) total/.exec(out)
    const f = tm ? /(\d+) failed/.exec(tm[1]!) : /(\d+) failed/.exec(m[1]!)
    const dm = /Time:\s*([\d.]+)\s*(ms|s|m)\b/.exec(out)
    return { runner: 'jest', files: parseInt(m[2]!, 10), tests: tm ? parseInt(tm[2]!, 10) : null, failed: f ? parseInt(f[1]!, 10) : 0, durationMs: dm ? toMs(dm[1]!, dm[2]!) : null, statusLine: m[0] }
  }
  // Playwright:  12 passed (1.2m)   /   2 failed
  m = /(\d+) passed \(([\d.]+)(ms|s|m)\)/.exec(out)
  if (m && /playwright|spec\.ts|Running \d+ tests? using/i.test(out)) {
    const f = /(\d+) failed/.exec(out)
    const total = parseInt(m[1]!, 10) + (f ? parseInt(f[1]!, 10) : 0)
    return { runner: 'playwright', files: null, tests: total, failed: f ? parseInt(f[1]!, 10) : 0, durationMs: toMs(m[2]!, m[3]!), statusLine: m[0] }
  }
  // pytest:  === 12 passed, 1 failed in 1.23s ===   /   collected 13 items
  m = /=+\s*([^\n=]*?\b(?:passed|failed|error|errors)\b[^\n=]*?)\s+in\s+([\d.]+)s/.exec(out)
  if (m) {
    const passed = /(\d+) passed/.exec(m[1]!)
    const failed = /(\d+) failed/.exec(m[1]!)
    const errors = /(\d+) errors?/.exec(m[1]!)
    const collected = /collected (\d+) items?/.exec(out)
    const tests = collected ? parseInt(collected[1]!, 10) : (passed ? parseInt(passed[1]!, 10) : 0) + (failed ? parseInt(failed[1]!, 10) : 0)
    return { runner: 'pytest', files: null, tests, failed: (failed ? parseInt(failed[1]!, 10) : 0) + (errors ? parseInt(errors[1]!, 10) : 0), durationMs: toMs(m[2]!, 's'), statusLine: m[0] }
  }
  // ESLint:  ✖ 3 problems (2 errors, 1 warning)
  m = /✖ (\d+) problems? \((\d+) errors?/.exec(out)
  if (m) return { runner: 'eslint', files: null, tests: null, failed: parseInt(m[2]!, 10), durationMs: null, statusLine: m[0] }
  // tsc:  Found 2 errors.
  m = /Found (\d+) errors?/.exec(out)
  if (m) return { runner: 'tsc', files: null, tests: null, failed: parseInt(m[1]!, 10), durationMs: null, statusLine: m[0] }
  return none
}

function runnerFromCommand(verb: string): string {
  const m = /\b(vitest|jest|pytest|playwright|cypress|eslint|biome|ruff|prettier|tsc|vue-tsc|mypy|pyright|cargo|go)\b/.exec(verb)
  if (m) return m[1]!
  if (/bin\/check/.test(verb)) return 'bin/check'
  return ''
}

/** Split a shell line at `&&`, `||`, `;`, `|` and newlines outside quotes (a `;` inside a sed script or a `-c "…"` string stays put). */
export function shellSegments(command: string): string[] {
  // Heredoc bodies are data, not commands: cut each one (from its `<<WORD`
  // line's end to the terminator line) and join backslash-newline continuations.
  command = command
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.slice(0, m.indexOf('\n')))
    .replace(/\\\r?\n/g, ' ')
  const out: string[] = []
  let cur = ''
  let q: '"' | "'" | '' = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (q) {
      cur += ch
      if (ch === '\\' && q === '"') cur += command[++i] ?? ''
      else if (ch === q) q = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      cur += ch
    } else if (ch === '\\') {
      cur += ch + (command[++i] ?? '')
    } else if ((ch === '&' || ch === '|') && command[i + 1] === ch) {
      out.push(cur)
      cur = ''
      i++
    } else if (ch === ';' || ch === '|' || ch === '\n') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/**
 * The part of a compound command that ran the verification: drop `cd …`,
 * VAR=… prefixes and housekeeping, and keep the first segment that names the
 * runner (else a tool-like one, else the longest). Agents wrap runs in
 * cd/env/cleanup chains that would otherwise make every command unique.
 */
export function focusCommand(command: string, runner = ''): string {
  const segments = shellSegments(command)
    .map((seg) => seg.replace(/^(?:do|then|else|\{)\s+/, '').replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, '').trim())
    .filter((seg) => seg && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(seg) && !/^cd\s/.test(seg) && !/^(?:export|set|true|rm|mkdir|sleep|echo|cat|ls|tail|head|grep|sed|awk|wait|kill|pkill|test|\[)\b/.test(seg))
  if (!segments.length) return command.replace(/\s+/g, ' ').trim().slice(0, 120)
  const named = runner ? segments.find((seg) => new RegExp(`\\b${runner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(seg)) : undefined
  const toolish = named ?? segments.find((seg) => /\b(?:vitest|jest|mocha|pytest|playwright|cypress|eslint|biome|ruff|tsc|vue-tsc|nuxi|mypy|pyright|cargo|go|make|npm|pnpm|yarn|bun|npx|docker|python3?|node|rake|bundle|gradle|mvn)\b/.test(seg))
  const pick = toolish ?? segments.reduce((a, b) => (b.length > a.length ? b : a))
  return pick.slice(0, 120)
}
