/**
 * Error with an HTTP-ish statusCode, throwable straight into an h3 handler.
 * `code` is herdr's error code when it gave one (agent_not_ready,
 * agent_prompt_stalled, …) or ours (cli_timeout, lock_busy,
 * agent_start_timeout) — match on it, not on the message.
 */
export class HerdrError extends Error {
  statusCode: number
  code?: string
  constructor(message: string, statusCode?: number, code?: string)
}

export interface HerdrTab {
  tabId: string
  label: string
  paneCount: number
  agentStatus: string | null
  focused: boolean
}
export interface HerdrWorkspace {
  workspaceId: string
  label: string
  focused: boolean
  agentStatus: string | null
  tabs: HerdrTab[]
}
export interface HerdrState {
  available: boolean
  workspaces: HerdrWorkspace[]
}

/**
 * Run a herdr CLI command and parse its JSON answer. Throws HerdrError
 * (503 not installed, 504 `cli_timeout` after `opts.timeoutMs` — default
 * 30s — or 502 with herdr's error `code`).
 */
export function herdrJson<T = any>(args: string[], opts?: { timeoutMs?: number }): Promise<T>

/**
 * Run `fn` holding the suite-wide herdr dispatch lock — one dispatch at a
 * time across every jSuite process (lock file in .data/herdr/). Re-entrant:
 * the topology helpers and startClaudeIn take it themselves, so wrap a whole
 * workspace → pane → claude sequence in it to make the sequence atomic.
 * Throws HerdrError 503 `lock_busy` after waiting 5 minutes.
 */
export function withHerdrLock<T>(fn: () => Promise<T>): Promise<T>

/** Workspaces + tabs, cached ~5s (the reads are one CLI call per workspace). */
export function herdrState(force?: boolean): Promise<HerdrState>
export function invalidateHerdrState(): void

/**
 * The workspace for a unit of work, by label, created --no-focus if missing.
 * A fresh workspace's root tab + pane come back as freshTab so the first
 * dispatch reuses them instead of leaving an orphan "1" tab.
 */
export function ensureHerdrWorkspace(
  label: string,
  cwd: string,
): Promise<{ workspaceId: string; freshTab: { tabId: string; paneId: string } | null }>

/**
 * A shell pane packed toward a 2×2 grid in tabs labelled `baseLabel`
 * ('LABEL', 'LABEL · 2', …); a fresh tab when they're all full.
 */
export function acquirePackedPane(
  workspaceId: string,
  baseLabel: string,
  cwd: string,
  freshTab: { tabId: string; paneId: string } | null,
): Promise<{ tabId: string; paneId: string }>

/**
 * Label a pane after the work running in it, so a packed 2×2 tab reads as four
 * named jobs. Best-effort and cosmetic — resolves false if herdr refuses.
 * Labels longer than 48 chars are trimmed.
 */
export function renamePane(paneId: string, label: string): Promise<boolean>

/** A fresh single-pane tab for a one-off job. */
export function createJobTab(
  workspaceId: string,
  baseLabel: string,
  cwd: string,
): Promise<{ tabId: string; paneId: string }>

/** Bring the terminal window hosting the herdr client to the macOS front. Best-effort. */
export function focusHerdrWindow(): Promise<boolean>

/**
 * Start claude in a shell pane under `name` (suffixed until free — live agent
 * names must be unique), submit the prompt, and confirm claude started on it.
 * Returns the name that stuck. Accepts the folder-trust dialog; any other
 * startup screen, or a prompt that never starts, throws HerdrError with the
 * pane's screen in the message. Blocks for seconds (up to a couple of minutes
 * worst case) — a slow button, not fire-and-forget. `opts.args` are extra CLI
 * args for the claude binary itself (e.g. ['--model', 'claude-opus-5-5']).
 */
export function startClaudeIn(
  paneId: string,
  name: string,
  prompt: string,
  opts?: { args?: string[] },
): Promise<string>

/**
 * Submit a prompt to a live agent and confirm claude started on it (working or
 * blocked): on a stall it presses Enter on text left in the input, resubmits
 * only when the input is empty and the prompt is nowhere on screen, and
 * otherwise throws HerdrError `agent_prompt_stalled`. Takes the dispatch lock.
 */
export function submitPrompt(agentName: string, prompt: string): Promise<void>

/**
 * Split a claude screen into the text above its input box and the text in the
 * box ('' when empty; null when no input box is on screen).
 */
export function readInputBox(screen: string): { input: string | null; before: string }

/** The keys that accept claude's folder-trust dialog, or null when the screen isn't it. */
export function trustDialogKeys(screen: string): string[] | null
