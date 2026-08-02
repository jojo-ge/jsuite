/**
 * What a prompt that says "you are running inside this repository" needs to
 * make that true: read-only file tools plus git-only Bash.
 */
export const ANALYSIS_TOOLS: string[]

/** Error with an HTTP-ish statusCode, throwable straight into an h3 handler. */
export class ClaudeError extends Error {
  statusCode: number
  constructor(message: string, statusCode?: number)
}

export interface RunClaudeOpts {
  cwd?: string
  /** CLI model name; defaults to the fast general-purpose model. */
  model?: string
  /**
   * Headless runs have nobody to approve a permission prompt, so any tool not
   * named here is refused rather than queued. Prompts that tell claude to go
   * read the repo MUST pass the tools that let it (see ANALYSIS_TOOLS).
   */
  allowedTools?: string[]
  /**
   * Kill switch. Aborting SIGTERMs the claude process — endpoints tie this to
   * the SSE connection so closing the EventSource cancels the run.
   */
  signal?: AbortSignal
  /** Overrides the JSUITE_CLAUDE_TIMEOUT_MS default (900000). */
  timeoutMs?: number
  /** Env-var name to mention in the timeout error, for apps with their own knob. */
  timeoutHint?: string
  log: (text: string) => void
  /**
   * When either delta handler is set, claude runs with
   * --include-partial-messages and thinking/answer text streams out
   * token-by-token as it is generated.
   */
  onThinking?: (text: string) => void
  onText?: (text: string) => void
}

/**
 * Runs `claude -p --output-format stream-json` and reports each event as it
 * happens via opts.log / onThinking / onText. Resolves with the text of the
 * final result event; rejects with ClaudeError (504 timeout, 499 cancelled).
 */
export function runClaude(prompt: string, opts: RunClaudeOpts): Promise<string>

/**
 * Pulls the first balanced JSON object out of a claude reply, repairing
 * fence-wrapping and common string-escaping mistakes. Throws ClaudeError when
 * no parseable object exists.
 */
export function extractJson(text: string): any
