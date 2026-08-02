import {
  ANALYSIS_TOOLS as SHARED_ANALYSIS_TOOLS,
  runClaude as runClaudeShared,
  type RunClaudeOpts as SharedRunClaudeOpts,
} from '@jsuite/claude'

// The runner itself lives in @jsuite/claude (extracted from here so every
// jSuite app can drive the local claude CLI). This shim keeps jDiff's Nitro
// auto-imports and its own timeout knob working unchanged.

export const ANALYSIS_TOOLS = SHARED_ANALYSIS_TOOLS

export type RunClaudeOpts = Omit<SharedRunClaudeOpts, 'timeoutMs' | 'timeoutHint'>

// Big analyze runs (four artifacts, with claude reading the diff and the
// surrounding repo itself) regularly push past five minutes, so this is
// overridable without a code change: JDIFF_CLAUDE_TIMEOUT_MS.
const JDIFF_TIMEOUT_MS = Number(process.env.JDIFF_CLAUDE_TIMEOUT_MS) || undefined

export function runClaude(prompt: string, opts: RunClaudeOpts): Promise<string> {
  return runClaudeShared(prompt, {
    ...opts,
    timeoutMs: JDIFF_TIMEOUT_MS,
    timeoutHint: 'JDIFF_CLAUDE_TIMEOUT_MS',
  })
}
