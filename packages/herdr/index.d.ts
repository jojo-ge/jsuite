/** Error with an HTTP-ish statusCode, throwable straight into an h3 handler. */
export class HerdrError extends Error {
  statusCode: number
  constructor(message: string, statusCode?: number)
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
 * (503 not installed, 502 command failed).
 */
export function herdrJson<T = any>(args: string[]): Promise<T>

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
 * names must be unique) and submit the prompt. Returns the name that stuck.
 * Blocks until herdr sees the agent ready (~seconds) — a slow button, not
 * fire-and-forget.
 */
export function startClaudeIn(paneId: string, name: string, prompt: string): Promise<string>
