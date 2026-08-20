// Driving Herdr (the terminal workspace manager) from jSuite apps.
//
// Extracted from jTicket, which grew the pattern: one WORKSPACE per unit of
// work (project / map), agents as PANES packed up to four per tab, one-off
// jobs as their own single-pane tab. Every create/split passes --no-focus so
// dispatching work never steals the screen; focus moves only through explicit
// focus endpoints.
//
// Everything degrades: no herdr binary or no running server ⇒ herdrState()
// reports { available: false } and app UIs hide their buttons.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

/** Error with an HTTP-ish statusCode, throwable straight into an h3 handler. */
export class HerdrError extends Error {
  constructor(message, statusCode = 502) {
    super(message)
    this.name = 'HerdrError'
    this.statusCode = statusCode
  }
}

// The dev server may not inherit a login PATH, and herdr installs to
// ~/.local/bin — try both. HERDR_BIN overrides everything.
const BIN_CANDIDATES = [
  ...(process.env.HERDR_BIN ? [process.env.HERDR_BIN] : []),
  'herdr',
  `${process.env.HOME}/.local/bin/herdr`,
]
let resolvedBin

async function herdrBin() {
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

/** Run a herdr CLI command and parse its JSON answer. Throws HerdrError 502/503. */
export async function herdrJson(args) {
  const bin = await herdrBin()
  if (!bin) {
    throw new HerdrError('herdr is not installed (or set HERDR_BIN to where it lives)', 503)
  }
  try {
    const { stdout } = await pExecFile(bin, args, { maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout)
  } catch (err) {
    // CLI server errors are JSON on stderr with an error message inside.
    let msg = String(err?.stderr || err?.message || err).trim()
    try {
      const parsed = JSON.parse(msg)
      msg = parsed?.error?.message ?? parsed?.message ?? msg
    } catch { /* plain text */ }
    throw new HerdrError(`herdr: ${msg.slice(0, 300)}`, 502)
  }
}

// ── Read state ──────────────────────────────────────────────────────────────

// Consumers refetch on every store change; hold the (multi-call) answer briefly.
const STATE_TTL_MS = 5_000
let stateCache = null

export async function herdrState(force = false) {
  if (!force && stateCache && Date.now() - stateCache.at < STATE_TTL_MS) return stateCache.state
  const state = await readState()
  stateCache = { at: Date.now(), state }
  return state
}

export function invalidateHerdrState() {
  stateCache = null
}

async function readState() {
  if (!(await herdrBin())) return { available: false, workspaces: [] }
  let list
  try {
    list = await herdrJson(['workspace', 'list'])
  } catch {
    // Installed but the server isn't running — same answer as not installed.
    return { available: false, workspaces: [] }
  }
  const workspaces = []
  for (const w of list?.result?.workspaces ?? []) {
    let tabs = []
    try {
      const t = await herdrJson(['tab', 'list', '--workspace', w.workspace_id])
      tabs = (t?.result?.tabs ?? []).map((tab) => ({
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
 * The workspace for a unit of work, by label, created --no-focus if missing.
 * A fresh workspace comes with a root tab + shell pane; hand those back so the
 * first dispatch uses them instead of leaving an orphan "1" tab.
 */
export async function ensureHerdrWorkspace(label, cwd) {
  const list = await herdrJson(['workspace', 'list'])
  const existing = (list?.result?.workspaces ?? []).find((w) => w.label === label)
  if (existing) return { workspaceId: existing.workspace_id, freshTab: null }
  const created = await herdrJson(['workspace', 'create', '--label', label, '--cwd', cwd, '--no-focus'])
  invalidateHerdrState()
  return {
    workspaceId: created.result.workspace.workspace_id,
    freshTab: { tabId: created.result.tab.tab_id, paneId: created.result.root_pane.pane_id },
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A shell pane packed toward a 2×2 grid: the first tab labelled `baseLabel`
 * (then 'baseLabel · 2', …) with room, split 2×2-wise; a fresh tab when
 * they're all full. Job tabs ('baseLabel · merge…') are never packed into.
 */
export async function acquirePackedPane(workspaceId, baseLabel, cwd, freshTab) {
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, baseLabel])
    return freshTab
  }

  const tabList = await herdrJson(['tab', 'list', '--workspace', workspaceId])
  const tabs = tabList?.result?.tabs ?? []
  const packedTabRe = new RegExp(`^${escapeRe(baseLabel)}( · \\d+)?$`)
  const packedTabs = tabs.filter((t) => packedTabRe.test(String(t.label ?? '')))

  const open = packedTabs.find((t) => Number(t.pane_count ?? 0) < 4)
  if (!open) {
    const label = packedTabs.length ? `${baseLabel} · ${packedTabs.length + 1}` : baseLabel
    const created = await herdrJson(['tab', 'create', '--workspace', workspaceId, '--label', label, '--cwd', cwd, '--no-focus'])
    invalidateHerdrState()
    return { tabId: created.result.tab.tab_id, paneId: created.result.root_pane.pane_id }
  }

  // Pack toward a 2×2 grid: 1 → split right; 2 → split the first down;
  // 3 → split the second down.
  const paneList = await herdrJson(['pane', 'list', '--workspace', workspaceId])
  const panes = (paneList?.result?.panes ?? []).filter((p) => p.tab_id === open.tab_id)
  if (!panes.length) throw new HerdrError(`herdr: tab ${open.tab_id} has no panes`, 502)
  const target = panes.length === 3 ? panes[1] : panes[0]
  const direction = panes.length === 1 ? 'right' : 'down'
  const split = await herdrJson(['pane', 'split', target.pane_id, '--direction', direction, '--cwd', cwd, '--no-focus'])
  invalidateHerdrState()
  return { tabId: open.tab_id, paneId: split.result.pane.pane_id }
}

/** A fresh single-pane tab for a one-off job (a merge sweep, a HITL ticket). */
export async function createJobTab(workspaceId, baseLabel, cwd) {
  const tabList = await herdrJson(['tab', 'list', '--workspace', workspaceId])
  const clashes = (tabList?.result?.tabs ?? []).filter((t) =>
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
let cachedBundleId

export async function focusHerdrWindow() {
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

async function clientBundleId() {
  if (cachedBundleId !== undefined) return cachedBundleId
  const { stdout } = await pExecFile('ps', ['ax', '-o', 'pid=,command='])
  const client = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\d+ (\S*\/)?herdr$/.test(l))
  if (!client) { cachedBundleId = null; return null }
  const pid = client.split(' ')[0]
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
export async function startClaudeIn(paneId, name, prompt) {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, 'a').slice(0, 28)
  const live = new Set(
    ((await herdrJson(['agent', 'list']))?.result?.agents ?? [])
      .map((a) => a.name)
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
    } catch (err) {
      const msg = String(err?.message ?? err)
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
    } catch (err) {
      const msg = String(err?.message ?? err)
      if (!msg.includes('stalled') || attempt >= 3) throw err
      await herdrJson(['agent', 'send-keys', agentName, 'esc']).catch(() => {})
      await herdrJson(['agent', 'send-keys', agentName, 'esc']).catch(() => {})
      await new Promise((r) => setTimeout(r, 750))
    }
  }
  invalidateHerdrState()
  return agentName
}
