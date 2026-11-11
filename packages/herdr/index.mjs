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
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { appDataFile } from '@jsuite/data'

const pExecFile = promisify(execFile)

/**
 * Error with an HTTP-ish statusCode, throwable straight into an h3 handler.
 * `code` is herdr's own error code when it gave one (agent_not_ready,
 * agent_prompt_stalled, …) or ours (cli_timeout, lock_busy) — match on it,
 * not on the message text.
 */
export class HerdrError extends Error {
  constructor(message, statusCode = 502, code = undefined) {
    super(message)
    this.name = 'HerdrError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** Default ceiling for one herdr CLI call — a wedged server must not hang a request (or the auto loop) forever. */
const CLI_TIMEOUT_MS = 30_000

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
      await pExecFile(bin, ['--version'], { timeout: 5_000 })
      resolvedBin = bin
      return bin
    } catch { /* next candidate */ }
  }
  resolvedBin = null
  return null
}

/**
 * Run a herdr CLI command and return its raw stdout. Throws HerdrError 503 (not
 * installed), 504 `cli_timeout` (no answer within `opts.timeoutMs`, default
 * 30s), or 502 carrying herdr's error `code`.
 */
async function herdrRun(args, opts = {}) {
  const bin = await herdrBin()
  if (!bin) {
    throw new HerdrError('herdr is not installed (or set HERDR_BIN to where it lives)', 503)
  }
  const timeoutMs = opts.timeoutMs ?? CLI_TIMEOUT_MS
  try {
    const { stdout } = await pExecFile(bin, args, { maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' })
    return stdout
  } catch (err) {
    if (err?.killed) {
      throw new HerdrError(`herdr ${args.slice(0, 2).join(' ')} did not answer within ${Math.round(timeoutMs / 1000)}s`, 504, 'cli_timeout')
    }
    // CLI server errors are JSON on stderr: { error: { code, message } }.
    let msg = String(err?.stderr || err?.stdout || err?.message || err).trim()
    let code
    try {
      const parsed = JSON.parse(msg)
      code = parsed?.error?.code
      msg = parsed?.error?.message ?? parsed?.message ?? msg
    } catch { /* plain text */ }
    throw new HerdrError(`herdr: ${msg.slice(0, 300)}`, 502, code)
  }
}

/** Run a herdr CLI command and parse its JSON answer. Throws HerdrError (see herdrRun). */
export async function herdrJson(args, opts = {}) {
  return JSON.parse(await herdrRun(args, opts))
}

// ── One dispatch at a time ──────────────────────────────────────────────────
// Every list-then-act step here (find-or-create a workspace, pick a pane to
// split, pick a free agent name, start + prompt claude) races any other
// dispatcher doing the same — and the dispatchers are several processes
// (jTicket's auto loop and buttons, jReview's watcher, jDiff, jCode) on
// one herdr server. So they all queue on one lock: in-process callers on a
// promise chain, processes on a lock file in .data/herdr/. Re-entrant within
// one async call chain, so a caller can hold it across a whole
// workspace → pane → claude sequence while the steps also take it themselves.
const lockContext = new AsyncLocalStorage()
let localQueue = Promise.resolve()
/** How long a dispatch waits for its turn before giving up (503 lock_busy). */
const LOCK_WAIT_MS = 5 * 60_000
/** A holder older than this is presumed wedged — no dispatch takes this long. */
const LOCK_STALE_MS = 5 * 60_000
const LOCK_POLL_MS = 250

function lockPath() {
  return process.env.JSUITE_HERDR_LOCK || appDataFile('herdr', 'dispatch.lock')
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM' // exists, just not ours
  }
}

async function readHolder(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null // mid-write or just removed
  }
}

async function acquireFileLock() {
  const path = lockPath()
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await writeFile(path, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' })
      return path
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err
    }
    // Held. Clear it if its holder is gone, is us (a leftover — in-process
    // callers queue before reaching the file), or has held it impossibly long.
    const holder = await readHolder(path)
    if (holder && (holder.pid === process.pid || !pidAlive(holder.pid) || Date.now() - holder.at > LOCK_STALE_MS)) {
      // Re-read just before removing, so a waiter that already replaced the
      // stale file doesn't get its fresh lock deleted from under it.
      const again = await readHolder(path)
      if (again && again.pid === holder.pid && again.at === holder.at) await rm(path, { force: true })
      continue
    }
    if (Date.now() > deadline) {
      throw new HerdrError(`herdr: another dispatch has held the herdr lock for over ${LOCK_WAIT_MS / 60_000} minutes (pid ${holder?.pid ?? '?'})`, 503, 'lock_busy')
    }
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS))
  }
}

/**
 * Run `fn` holding the suite-wide herdr dispatch lock. Nested calls inside
 * `fn` run straight through.
 */
export async function withHerdrLock(fn) {
  if (lockContext.getStore()) return fn()
  const prev = localQueue
  let release
  localQueue = new Promise((r) => { release = r })
  try {
    await prev
    const path = await acquireFileLock()
    try {
      return await lockContext.run(true, fn)
    } finally {
      await rm(path, { force: true }).catch(() => {})
    }
  } finally {
    release()
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
export function ensureHerdrWorkspace(label, cwd) {
  return withHerdrLock(() => ensureWorkspaceLocked(label, cwd))
}

async function ensureWorkspaceLocked(label, cwd) {
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
export function acquirePackedPane(workspaceId, baseLabel, cwd, freshTab) {
  return withHerdrLock(() => acquirePackedPaneLocked(workspaceId, baseLabel, cwd, freshTab))
}

async function acquirePackedPaneLocked(workspaceId, baseLabel, cwd, freshTab) {
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

  // Pack toward a 2×2 grid by always splitting whichever pane still owns the
  // most screen: 1 pane ⇒ split it right; 2 ⇒ the left column splits down;
  // 3 ⇒ the still-full-height right column splits down. Picking the target by
  // geometry matters — `pane list` comes back in spatial order, not creation
  // order, so indexing into it stacked the third split on the left column and
  // gave 3 panes left / 1 right.
  const paneList = await herdrJson(['pane', 'list', '--workspace', workspaceId])
  const panes = (paneList?.result?.panes ?? []).filter((p) => p.tab_id === open.tab_id)
  if (!panes.length) throw new HerdrError(`herdr: tab ${open.tab_id} has no panes`, 502)
  const target = await largestPane(panes)
  const direction = panes.length === 1 ? 'right' : 'down'
  const split = await herdrJson(['pane', 'split', target.pane_id, '--direction', direction, '--cwd', cwd, '--no-focus'])
  invalidateHerdrState()
  return { tabId: open.tab_id, paneId: split.result.pane.pane_id }
}

/**
 * The pane holding the biggest rectangle in its tab — the one a 2×2 pack
 * splits next. Ties (two equal halves) go to the first in spatial order, i.e.
 * the left/top one. Falls back to spatial position if herdr can't hand over a
 * layout: with two panes the left one is first, otherwise the un-split column
 * is last.
 */
async function largestPane(panes) {
  if (panes.length === 1) return panes[0]
  let rects = []
  try {
    const layout = await herdrJson(['pane', 'layout', '--pane', panes[0].pane_id])
    rects = layout?.result?.layout?.panes ?? []
  } catch { /* no geometry — fall back below */ }
  const area = new Map(rects.map((p) => [p.pane_id, (p.rect?.width ?? 0) * (p.rect?.height ?? 0)]))
  if (!area.size) return panes.length === 2 ? panes[0] : panes[panes.length - 1]
  return panes.reduce((best, p) => ((area.get(p.pane_id) ?? 0) > (area.get(best.pane_id) ?? 0) ? p : best))
}

/**
 * Label a pane after the work running in it (a ticket key + summary), so a
 * packed 2×2 tab reads as four named jobs rather than four claude spinners.
 * Best-effort and cosmetic: herdr falls back to the terminal title, so a
 * rename failure must never sink an otherwise-good dispatch.
 */
export async function renamePane(paneId, label) {
  const text = String(label ?? '').trim().slice(0, 48)
  if (!text) return false
  try {
    await herdrJson(['pane', 'rename', paneId, text])
    invalidateHerdrState()
    return true
  } catch {
    return false
  }
}

/** A fresh single-pane tab for a one-off job (a merge sweep, a HITL ticket). */
export function createJobTab(workspaceId, baseLabel, cwd) {
  return withHerdrLock(() => createJobTabLocked(workspaceId, baseLabel, cwd))
}

async function createJobTabLocked(workspaceId, baseLabel, cwd) {
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
// Three ways a dispatch used to die quietly, each handled below:
//   1. The pane's shell isn't at its prompt yet → retry `agent start` briefly.
//   2. Claude stops at a startup screen (herdr: agent_not_ready) → clear the
//      folder-trust dialog; fail loudly, with the screen, on anything else.
//   3. The prompt's Enter gets eaten (the '/' command popup race, a paste still
//      being processed) → herdr only reports that with --wait, so always wait
//      for claude to start working, and on a stall look at the pane before
//      acting: press Enter on text left in the input, resubmit only when the
//      input is empty and the prompt is nowhere on screen.

/** How long a fresh pane's shell gets to reach its prompt. */
const SHELL_READY_MS = 15_000
/** How long claude gets to come up (herdr's own default is 30s; plugins and MCP servers make cold starts slower). */
const AGENT_READY_MS = 45_000
/** How long a submitted prompt gets to show claude working (herdr's stall gate is 5s inside this). */
const SUBMIT_WAIT_MS = 15_000
const SUBMIT_ATTEMPTS = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RULE_RE = /^\s*[╭╰]?─{8,}[╮╯]?\s*$/
const INPUT_RE = /^\s*│?\s*[❯>](\s|$)/

/**
 * Split a claude screen into what's above its input box and the text in the
 * box (`input`, '' when empty). The box is a horizontal rule, a line starting
 * '❯', then everything up to the next rule. `input` is null when no box is
 * on screen (a dialog, a different UI) — callers must not read that as empty.
 */
export function readInputBox(screen) {
  const lines = String(screen ?? '').split('\n')
  for (let i = lines.length - 1; i > 0; i--) {
    if (!INPUT_RE.test(lines[i]) || !RULE_RE.test(lines[i - 1])) continue
    const box = [lines[i].replace(INPUT_RE, '')]
    for (let j = i + 1; j < lines.length && !RULE_RE.test(lines[j]); j++) box.push(lines[j].replace(/^\s*│/, ''))
    return { input: box.join('\n').replace(/│\s*$/gm, '').trim(), before: lines.slice(0, i - 1).join('\n') }
  }
  return { input: null, before: String(screen ?? '') }
}

/**
 * The keys that accept claude's trust-this-folder dialog, or null when the
 * screen isn't that dialog (or its options can't be read). Works out the
 * moves from wherever the cursor sits to the "Yes" option, so it holds
 * whichever order claude lists them in — Enter alone picks "No, exit" today.
 */
export function trustDialogKeys(screen) {
  const text = String(screen ?? '')
  if (!/trust (the files in )?this (folder|directory)|one you trust/i.test(text)) return null
  // Options may be numbered ('❯ 1. Yes, …') or not ('❯ No, exit').
  const options = text.split('\n').filter((l) => /^\s*(?:[❯›>]\s*)?(?:\d+\.\s+)?(?:yes|no)\b/i.test(l))
  const yes = options.findIndex((l) => /\byes\b/i.test(l))
  const cursor = options.findIndex((l) => /^\s*[❯›>]/.test(l))
  if (yes < 0 || cursor < 0) return null
  const moves = yes - cursor
  return [...Array(Math.abs(moves)).fill(moves > 0 ? 'down' : 'up'), 'enter']
}

const tail = (text, n = 12) => String(text ?? '').trimEnd().split('\n').slice(-n).join('\n')

async function screenText(target, kind = 'agent') {
  try {
    return await herdrRun([kind, 'read', target, '--source', 'visible', '--format', 'text'])
  } catch {
    return ''
  }
}

async function agentStatus(agentName) {
  try {
    return (await herdrJson(['agent', 'get', agentName]))?.result?.agent?.agent_status ?? null
  } catch {
    return null
  }
}

/** Wait for one of `states`; the status reached, or null on timeout / no such agent. */
async function waitFor(agentName, states, ms) {
  try {
    await herdrJson(
      ['agent', 'wait', agentName, ...states.flatMap((s) => ['--until', s]), '--timeout', String(ms)],
      { timeoutMs: ms + 10_000 },
    )
    return await agentStatus(agentName)
  } catch {
    return null
  }
}

/**
 * Get claude from a startup screen to its prompt. Only the folder-trust
 * dialog is answered for you — the pane's cwd is the repo you pointed the
 * project at. Anything else throws with what's on screen, so the failure says
 * what to answer instead of leaving a silent stuck pane.
 */
async function clearStartupScreen(agentName) {
  for (let round = 0; round < 3; round++) {
    const status = await agentStatus(agentName)
    if (status === 'idle' || status === 'done') return
    let screen = await screenText(agentName)
    let keys = trustDialogKeys(screen)
    if (!keys) {
      // Possibly mid-redraw (right after a dialog is answered herdr still
      // says blocked while claude repaints) — one short grace wait, then look again.
      if (await waitFor(agentName, ['idle', 'done'], 5_000)) return
      screen = await screenText(agentName)
      keys = trustDialogKeys(screen)
    }
    if (!keys) {
      throw new HerdrError(
        `herdr: claude (${agentName}) stopped at a startup screen jSuite can't answer — answer it in its pane, then re-run. On screen:\n${tail(screen)}`,
        502,
        'agent_not_ready',
      )
    }
    console.warn(`[herdr] ${agentName}: accepting the folder-trust dialog (${keys.join(' ')})`)
    await herdrJson(['agent', 'send-keys', agentName, ...keys])
    await sleep(1_000)
    if (await waitFor(agentName, ['idle', 'done'], AGENT_READY_MS)) return
  }
  throw new HerdrError(`herdr: claude (${agentName}) is still not ready after clearing its startup screens`, 502, 'agent_not_ready')
}

function isShellBusy(err) {
  return String(err?.message ?? err).includes('not an available shell')
}
function isNotReady(err) {
  return err?.code === 'agent_not_ready' || /blocked during startup|not ready for prompts/i.test(String(err?.message ?? err))
}
function isTimeout(err) {
  return err?.code === 'timeout' || err?.code === 'cli_timeout' || /timed? ?out/i.test(String(err?.message ?? err))
}

async function startAgent(paneId, name, opts) {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, 'a').slice(0, 28)
  const live = new Set(
    ((await herdrJson(['agent', 'list']))?.result?.agents ?? [])
      .map((a) => a.name)
      .filter(Boolean),
  )
  let agentName = base
  for (let i = 2; live.has(agentName); i++) agentName = `${base}-${i}`

  const deadline = Date.now() + SHELL_READY_MS
  for (;;) {
    try {
      await herdrJson(
        [
          'agent', 'start', agentName, '--kind', 'claude', '--pane', paneId, '--timeout', String(AGENT_READY_MS),
          ...(opts.args?.length ? ['--', ...opts.args] : []),
        ],
        { timeoutMs: AGENT_READY_MS + 15_000 },
      )
      return agentName
    } catch (err) {
      if (isShellBusy(err) && Date.now() < deadline) {
        await sleep(500)
        continue
      }
      if (isShellBusy(err)) {
        throw new HerdrError(`herdr: pane ${paneId}'s shell never reached its prompt in ${SHELL_READY_MS / 1000}s. On screen:\n${tail(await screenText(paneId, 'pane'))}`, 502, 'agent_pane_busy')
      }
      if (isNotReady(err)) {
        await clearStartupScreen(agentName)
        return agentName
      }
      if (isTimeout(err)) {
        // Claude may still be coming up — one more window before giving up.
        const status = await waitFor(agentName, ['idle', 'done', 'blocked'], AGENT_READY_MS)
        if (status === 'idle' || status === 'done') return agentName
        if (status === 'blocked') {
          await clearStartupScreen(agentName)
          return agentName
        }
        throw new HerdrError(`herdr: claude did not come up in pane ${paneId}. On screen:\n${tail(await screenText(paneId, 'pane'))}`, 504, 'agent_start_timeout')
      }
      throw err
    }
  }
}

function isStall(err) {
  return err?.code === 'agent_prompt_stalled' || isTimeout(err) || /stall/i.test(String(err?.message ?? err))
}

/** Is the prompt on screen above the input box — i.e. already submitted? */
function promptOnScreen(before, prompt) {
  const head = String(prompt).trim().split('\n')[0].slice(0, 30).trim()
  return (head && before.includes(head)) || /\[Pasted text #\d+/.test(before)
}

/**
 * Submit `prompt` to a live agent and make sure claude actually started on it
 * (working or blocked). Throws HerdrError `agent_prompt_stalled` if it can't
 * get there — never reports success on a prompt left sitting in the input.
 * Takes the dispatch lock.
 */
export function submitPrompt(agentName, prompt) {
  return withHerdrLock(() => submitPromptLocked(agentName, prompt))
}

async function submitPromptLocked(agentName, prompt) {
  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt++) {
    try {
      await herdrJson(
        ['agent', 'prompt', agentName, prompt, '--wait', '--until', 'working', '--until', 'blocked', '--timeout', String(SUBMIT_WAIT_MS)],
        { timeoutMs: SUBMIT_WAIT_MS + 10_000 },
      )
      return
    } catch (err) {
      if (!isStall(err)) throw err
    }

    // No activity seen. That doesn't prove the prompt wasn't delivered — look.
    const status = await agentStatus(agentName)
    if (status === 'working' || status === 'blocked') return
    const { input, before } = readInputBox(await screenText(agentName))

    if (input) {
      // Text left in the input: the Enter got eaten. Close a '/' popup if one
      // could be open (a single esc never clears claude's input), then Enter.
      console.warn(`[herdr] ${agentName}: prompt sat unsubmitted (attempt ${attempt}) — pressing Enter`)
      const keys = input.startsWith('/') ? ['esc', 'enter'] : ['enter']
      for (const key of keys) {
        await herdrJson(['agent', 'send-keys', agentName, key])
        await sleep(300)
      }
      if (await waitFor(agentName, ['working', 'blocked'], SUBMIT_WAIT_MS)) return
      break // still sitting there — resubmitting would paste it twice
    }

    if (input === '' && !promptOnScreen(before, prompt)) {
      // Empty input and no sign of the prompt: it never landed. Resubmit.
      console.warn(`[herdr] ${agentName}: prompt never reached claude's input (attempt ${attempt}) — resubmitting`)
      continue
    }

    if (input === '') return // submitted; the turn just went by faster than herdr's gate saw it

    // No input box on screen — some dialog we can't read. Enter on an empty
    // input is harmless, so try that once; never resubmit blind.
    await herdrJson(['agent', 'send-keys', agentName, 'enter']).catch(() => {})
    if (await waitFor(agentName, ['working', 'blocked'], SUBMIT_WAIT_MS)) return
    break
  }
  throw new HerdrError(
    `herdr: claude (${agentName}) never started on its prompt. On screen:\n${tail(await screenText(agentName))}`,
    502,
    'agent_prompt_stalled',
  )
}

/**
 * Start claude in a shell pane under `name` (suffixed until free — live agent
 * names must be unique), submit the prompt, and confirm claude started on it.
 * Returns the name that stuck. Holds the dispatch lock throughout and logs
 * any failure before throwing it. `opts.args` are extra CLI args for the
 * claude binary itself (herdr passes everything after `--` through) — e.g.
 * ['--model', 'claude-opus-5-5'].
 */
export function startClaudeIn(paneId, name, prompt, opts = {}) {
  return withHerdrLock(async () => {
    try {
      const agentName = await startAgent(paneId, name, opts)
      await submitPromptLocked(agentName, prompt)
      invalidateHerdrState()
      return agentName
    } catch (err) {
      console.error(`[herdr] could not start ${name} in pane ${paneId}: ${err?.message ?? err}`)
      throw err
    }
  })
}
