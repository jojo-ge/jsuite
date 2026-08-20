// Driving Herdr (the terminal workspace manager) from jTicket.
//
// The hand-off prompts on /next don't have to go through the clipboard: jTicket
// can build the terminal itself over Herdr's socket CLI — one WORKSPACE per
// project (labelled with the project title, cwd = the repo), ticket work as
// PANES packed up to four per tab (tabs labelled with the project key:
// 'PROJ-2', 'PROJ-2 · 2', …), and merge jobs as their own single-pane tab
// ('PROJ-2 · merge'). Every create/split passes --no-focus so dispatching work
// never steals the screen; focus moves only through the explicit focus
// endpoint (the "go to herdr" buttons).
//
// Everything degrades: no herdr binary or no running server ⇒ state reports
// { available: false } and the UI hides the buttons.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

// The dev server may not inherit a login PATH, and herdr installs to
// ~/.local/bin — try both. HERDR_BIN overrides everything.
const BIN_CANDIDATES = [
  ...(process.env.HERDR_BIN ? [process.env.HERDR_BIN] : []),
  'herdr',
  `${process.env.HOME}/.local/bin/herdr`,
]
let resolvedBin: string | null | undefined

async function herdrBin(): Promise<string | null> {
  if (resolvedBin !== undefined) return resolvedBin
  for (const bin of BIN_CANDIDATES) {
    try {
      await pExecFile(bin, ['--version'])
      resolvedBin = bin
      return bin
    } catch { /* next candidate */ }
  }
  resolvedBin = null
  return null
}

/** Run a herdr CLI command and parse its JSON answer. Throws 502/503 h3 errors. */
export async function herdrJson<T = any>(args: string[]): Promise<T> {
  const bin = await herdrBin()
  if (!bin) {
    throw createError({ statusCode: 503, statusMessage: 'herdr is not installed (or set HERDR_BIN to where it lives)' })
  }
  try {
    const { stdout } = await pExecFile(bin, args, { maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout) as T
  } catch (err: any) {
    // CLI server errors are JSON on stderr with an error message inside.
    let msg = String(err?.stderr || err?.message || err).trim()
    try {
      const parsed = JSON.parse(msg)
      msg = parsed?.error?.message ?? parsed?.message ?? msg
    } catch { /* plain text */ }
    throw createError({ statusCode: 502, statusMessage: `herdr: ${msg.slice(0, 300)}` })
  }
}

// ── Read state ──────────────────────────────────────────────────────────────
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

// /next refetches on every tracker change; hold the (multi-call) answer briefly.
const STATE_TTL_MS = 5_000
let stateCache: { at: number; state: HerdrState } | null = null

export async function herdrState(force = false): Promise<HerdrState> {
  if (!force && stateCache && Date.now() - stateCache.at < STATE_TTL_MS) return stateCache.state
  const state = await readState()
  stateCache = { at: Date.now(), state }
  return state
}

export function invalidateHerdrState(): void {
  stateCache = null
}

async function readState(): Promise<HerdrState> {
  if (!(await herdrBin())) return { available: false, workspaces: [] }
  let list: any
  try {
    list = await herdrJson(['workspace', 'list'])
  } catch {
    // Installed but the server isn't running — same answer as not installed.
    return { available: false, workspaces: [] }
  }
  const workspaces: HerdrWorkspace[] = []
  for (const w of list?.result?.workspaces ?? []) {
    let tabs: HerdrTab[] = []
    try {
      const t = await herdrJson(['tab', 'list', '--workspace', w.workspace_id])
      tabs = (t?.result?.tabs ?? []).map((tab: any) => ({
        tabId: tab.tab_id,
        label: String(tab.label ?? ''),
        paneCount: Number(tab.pane_count ?? 0),
        agentStatus: tab.agent_status ?? null,
        focused: !!tab.focused,
      }))
    } catch { /* workspace vanished between calls */ }
    workspaces.push({
      workspaceId: w.workspace_id,
      label: String(w.label ?? ''),
      focused: !!w.focused,
      agentStatus: w.agent_status ?? null,
      tabs,
    })
  }
  return { available: true, workspaces }
}

// ── Build topology ──────────────────────────────────────────────────────────
/**
 * The project's workspace, by label (= project title), created --no-focus if
 * missing. A fresh workspace comes with a root tab + shell pane; hand those
 * back so the first dispatch uses them instead of leaving an orphan "1" tab.
 */
export async function ensureHerdrWorkspace(
  label: string,
  cwd: string,
): Promise<{ workspaceId: string; freshTab: { tabId: string; paneId: string } | null }> {
  const list = await herdrJson(['workspace', 'list'])
  const existing = (list?.result?.workspaces ?? []).find((w: any) => w.label === label)
  if (existing) return { workspaceId: existing.workspace_id, freshTab: null }
  const created = await herdrJson(['workspace', 'create', '--label', label, '--cwd', cwd, '--no-focus'])
  invalidateHerdrState()
  return {
    workspaceId: created.result.workspace.workspace_id,
    freshTab: { tabId: created.result.tab.tab_id, paneId: created.result.root_pane.pane_id },
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A shell pane for a ticket: the first ticket tab (label = project key, then
 * 'KEY · 2', …) with room, split 2×2-wise; a fresh tab when they're all full.
 * Merge tabs ('KEY · merge…') are never packed with ticket panes.
 */
export async function acquireTicketPane(
  workspaceId: string,
  projectKey: string,
  cwd: string,
  freshTab: { tabId: string; paneId: string } | null,
): Promise<{ tabId: string; paneId: string }> {
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, projectKey])
    return freshTab
  }

  const tabList = await herdrJson(['tab', 'list', '--workspace', workspaceId])
  const tabs: any[] = tabList?.result?.tabs ?? []
  const ticketTabRe = new RegExp(`^${escapeRe(projectKey)}( · \\d+)?$`)
  const ticketTabs = tabs.filter((t) => ticketTabRe.test(String(t.label ?? '')))

  const open = ticketTabs.find((t) => Number(t.pane_count ?? 0) < 4)
  if (!open) {
    const label = ticketTabs.length ? `${projectKey} · ${ticketTabs.length + 1}` : projectKey
    const created = await herdrJson(['tab', 'create', '--workspace', workspaceId, '--label', label, '--cwd', cwd, '--no-focus'])
    invalidateHerdrState()
    return { tabId: created.result.tab.tab_id, paneId: created.result.root_pane.pane_id }
  }

  // Pack toward a 2×2 grid: 1 → split right; 2 → split the first down;
  // 3 → split the second down.
  const paneList = await herdrJson(['pane', 'list', '--workspace', workspaceId])
  const panes: any[] = (paneList?.result?.panes ?? []).filter((p: any) => p.tab_id === open.tab_id)
  if (!panes.length) throw createError({ statusCode: 502, statusMessage: `herdr: tab ${open.tab_id} has no panes` })
  const target = panes.length === 3 ? panes[1] : panes[0]
  const direction = panes.length === 1 ? 'right' : 'down'
  const split = await herdrJson(['pane', 'split', target.pane_id, '--direction', direction, '--cwd', cwd, '--no-focus'])
  invalidateHerdrState()
  return { tabId: open.tab_id, paneId: split.result.pane.pane_id }
}

/** A fresh single-pane tab for a one-off job (the merge sweep). */
export async function createJobTab(
  workspaceId: string,
  baseLabel: string,
  cwd: string,
): Promise<{ tabId: string; paneId: string }> {
  const tabList = await herdrJson(['tab', 'list', '--workspace', workspaceId])
  const clashes = (tabList?.result?.tabs ?? []).filter((t: any) =>
    String(t.label ?? '').startsWith(baseLabel),
  ).length
  const label = clashes ? `${baseLabel} ${clashes + 1}` : baseLabel
  const created = await herdrJson(['tab', 'create', '--workspace', workspaceId, '--label', label, '--cwd', cwd, '--no-focus'])
  invalidateHerdrState()
  return { tabId: created.result.tab.tab_id, paneId: created.result.root_pane.pane_id }
}

// ── Focusing the actual window ──────────────────────────────────────────────
// Herdr's own focus commands move focus *inside* the session; they can't bring
// the hosting terminal window to the front of macOS. For that: find the herdr
// client process (command `herdr`, not `herdr server`), read which app hosts
// it from its __CFBundleIdentifier, and ask that app to activate. Best-effort —
// any failure leaves the in-herdr focus done and the window where it was.
let cachedBundleId: string | null | undefined

export async function focusHerdrWindow(): Promise<boolean> {
  try {
    const bundleId = await clientBundleId()
    if (!bundleId) return false
    await pExecFile('osascript', ['-e', `tell application id "${bundleId}" to activate`])
    return true
  } catch {
    cachedBundleId = undefined // re-resolve next time — the client may have moved
    return false
  }
}

async function clientBundleId(): Promise<string | null> {
  if (cachedBundleId !== undefined) return cachedBundleId
  const { stdout } = await pExecFile('ps', ['ax', '-o', 'pid=,command='])
  const client = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\d+ (\S*\/)?herdr$/.test(l))
  if (!client) { cachedBundleId = null; return null }
  const pid = client.split(' ')[0]!
  const { stdout: env } = await pExecFile('ps', ['eww', pid])
  const m = env.match(/__CFBundleIdentifier=(\S+)/)
  cachedBundleId = m?.[1] ?? null
  return cachedBundleId
}

// ── Start the agent ─────────────────────────────────────────────────────────
/**
 * Start claude in a shell pane under `name` (suffixed until free — live agent
 * names must be unique) and submit the prompt. Returns the name that stuck.
 * `agent start` blocks until herdr sees the agent ready (~seconds), so the
 * endpoint that calls this is a slow button, not a fire-and-forget.
 */
export async function startClaudeIn(paneId: string, name: string, prompt: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, 'a').slice(0, 28)
  const live = new Set<string>(
    ((await herdrJson(['agent', 'list']))?.result?.agents ?? [])
      .map((a: any) => a.name)
      .filter(Boolean),
  )
  let agentName = base
  for (let i = 2; live.has(agentName); i++) agentName = `${base}-${i}`

  // A just-created pane's shell takes a beat to reach its prompt, and until it
  // does herdr refuses with "not an available shell" — retry that (and only
  // that) for a few seconds.
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      await herdrJson(['agent', 'start', agentName, '--kind', 'claude', '--pane', paneId])
      break
    } catch (err: any) {
      const msg = String(err?.statusMessage ?? err)
      if (!msg.includes('not an available shell') || Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // Submit the prompt. Hand-offs start with a slash command, and pasting '/'
  // into claude can race its command popup — the encoded Enter gets eaten and
  // herdr reports agent_prompt_stalled with the text left sitting in the input.
  // On a stall: esc to dismiss any popup and clear the input, then resubmit.
  for (let attempt = 1; ; attempt++) {
    try {
      await herdrJson(['agent', 'prompt', agentName, prompt])
      break
    } catch (err: any) {
      const msg = String(err?.statusMessage ?? err)
      if (!msg.includes('stalled') || attempt >= 3) throw err
      await herdrJson(['agent', 'send-keys', agentName, 'esc']).catch(() => {})
      await herdrJson(['agent', 'send-keys', agentName, 'esc']).catch(() => {})
      await new Promise((r) => setTimeout(r, 750))
    }
  }
  invalidateHerdrState()
  return agentName
}
