import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Run, Workspace } from './agentStore'

const pExecFile = promisify(execFile)

// The run lifecycle: dispatch → provision → running → needs_review → accept /
// discard, plus the observers (completion via jTicket's stream, pane scans)
// and the fleet scheduler that drains each workspace's queue.
//
// `run()` here is the @jsuite/diff layer's process runner (auto-imported);
// run RECORDS are always named `r`.

const git = (args: string[], cwd: string, opts?: { okCodes?: number[] }) => run('git', args, cwd, opts)

const AGENT_NAME = 'jagent'

// ---------------------------------------------------------------------------
// Dispatch

export async function dispatchTicket(workspaceId: string, ticketKey: string, force = false): Promise<Run> {
  const state = loadAgentState()
  const ws = findWorkspace(state, workspaceId)

  // Preflight loudly rather than spawning into nothing.
  if (!(await tmuxAvailable())) {
    throw createError({ statusCode: 500, message: 'tmux is not installed — `brew install tmux` before dispatching' })
  }
  if (!existsSync(ws.repo)) {
    throw createError({ statusCode: 400, message: `workspace repo missing: ${ws.repo}` })
  }

  const ticket = await trackerTicket(ticketKey)
  if (ticket.status === 'done') {
    throw createError({ statusCode: 409, message: `${ticket.key} is already done` })
  }
  if (ticket.blocked && !force) {
    throw createError({
      statusCode: 409,
      message: `${ticket.key} is blocked — its blockers hold facts the work depends on. Dispatch with override to ignore.`,
    })
  }
  if (ticket.assignee && ticket.assignee !== AGENT_NAME && !force) {
    throw createError({ statusCode: 409, message: `${ticket.key} is claimed by "${ticket.assignee}"` })
  }
  const dupe = state.runs.find((r) => r.workspaceId === ws.id && r.ticketKey === ticket.key && isLive(r))
  if (dupe) {
    throw createError({ statusCode: 409, message: `${ticket.key} already has a live run (${dupe.id})` })
  }

  const branch = ticket.key.toLowerCase()
  const session = `jagent-${branch}`
  const worktree = join(worktreeRoot(ws), branch)
  const leftover = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], ws.repo, { okCodes: [1] })).trim()
  if (leftover) {
    throw createError({
      statusCode: 409,
      message: `branch ${branch} already exists in ${ws.repo} — a previous run left it behind; delete it (or its PR) first`,
    })
  }

  // The claim happens on jAgent's side, before anything spawns — that is what
  // makes double-dispatch impossible.
  await trackerPatchTicket(ticket.key, { assignee: AGENT_NAME, status: 'in_progress' })

  await git(['worktree', 'add', worktree, '-b', branch, ws.base], ws.repo)

  const r: Run = {
    id: newAgentId('run'),
    workspaceId: ws.id,
    ticketKey: ticket.key,
    ticketTitle: ticket.title,
    branch,
    worktree,
    session,
    status: 'starting',
    resolutionSeen: ticket.resolution,
    resolution: ticket.resolution,
    needsYou: false,
    needsYouSince: null,
    lastActivityAt: null,
    diffStat: null,
    error: null,
    prUrl: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  mutateAgentState((s) => s.runs.unshift(r))

  // Setup can take a minute (pnpm install) — provision off the request path.
  void provision(r.id).catch((err) => {
    patchRun(r.id, { status: 'failed', error: String(err?.message ?? err) })
  })
  return r
}

async function provision(runId: string): Promise<void> {
  const state = loadAgentState()
  const r = findRun(state, runId)
  const ws = findWorkspace(state, r.workspaceId)
  const env = worktreeEnv(ws)
  const dir = runDir(r.id)

  if (ws.setup.trim()) {
    try {
      const { stdout, stderr } = await pExecFile('sh', ['-c', ws.setup], {
        cwd: r.worktree,
        env: { ...process.env, ...env },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
      })
      writeFileSync(join(dir, 'setup.log'), stdout + stderr)
    } catch (err: any) {
      writeFileSync(join(dir, 'setup.log'), String(err?.stdout ?? '') + String(err?.stderr ?? err))
      throw new Error(`setup command failed — see ${join(dir, 'setup.log')}`)
    }
  }

  writePermissions(r.worktree)

  const preambleFile = join(dir, 'preamble.md')
  writeFileSync(preambleFile, preamble(r, ws))
  // The preamble rides in as system prompt so the initial prompt stays a bare
  // slash command, which the CLI parses as the jimplement skill invocation.
  const cmd = `claude --append-system-prompt "$(cat ${shq(preambleFile)})" ${shq(`/jimplement ${r.ticketKey}`)}`
  await tmuxSpawn(r.session, r.worktree, env, cmd)

  patchRun(r.id, { status: 'running', lastActivityAt: nowIso() })
}

function worktreeEnv(ws: Workspace): Record<string, string> {
  const env: Record<string, string> = {}
  // A fresh worktree resolves its own (empty) .data by walking up to its own
  // workspace file — point it back at the real one when the repo carries one.
  const data = join(ws.repo, '.data')
  if (existsSync(data)) env.JSUITE_DATA_DIR = data
  return env
}

// The allowlist that makes the common path unattended: the work of building.
// Anything outside it still prompts — jAgent flags the prompt in the rail and
// the human approves from the browser. Never --dangerously-skip-permissions:
// a worktree isolates files, it does not sandbox Bash.
function writePermissions(worktree: string): void {
  const dir = join(worktree, '.claude')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'settings.local.json'),
    JSON.stringify(
      {
        permissions: {
          allow: [
            'Read', 'Grep', 'Glob', 'Edit', 'Write',
            'Bash(pnpm:*)', 'Bash(git:*)', 'Bash(node:*)', 'Bash(npx:*)',
            'Bash(jq:*)', 'Bash(curl:*)',
            'WebFetch(domain:jticket.local)',
          ],
        },
      },
      null,
      2,
    ) + '\n',
  )
}

function preamble(r: Run, ws: Workspace): string {
  return `You were dispatched by jAgent onto ticket ${r.ticketKey}. You are in an isolated git worktree on branch ${r.branch} (cut from ${ws.base}). A human is watching your diff live in jAgent and reviews it when you finish.

House rules — these override anything the jimplement skill says:

1. The ticket is already claimed for you (assignee "${AGENT_NAME}", status in_progress). Skip the claim step.
2. NEVER change the ticket's status — not to done, not to anything. When the acceptance criteria are met and the checks are green, PATCH only the resolution field. A non-empty resolution is the finished signal; the human accepts your diff in jAgent and jAgent flips the ticket to done.
3. Do not push and do not open a PR. Commit locally as you like; jAgent commits anything outstanding, pushes, and opens the PR at accept time.
4. Nudges arrive as messages in this session (and as ticket comments). Address the feedback, then UPDATE the resolution — a changed resolution is the finished signal each round.
5. Verify with typechecks and tests, not by booting dev servers — the suite's ports are taken by the real apps.
`
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// ---------------------------------------------------------------------------
// Review actions

export async function acceptRun(runId: string): Promise<{ prUrl: string; jdiffUrl: string }> {
  const state = loadAgentState()
  const r = findRun(state, runId)
  const ws = findWorkspace(state, r.workspaceId)
  if (r.status !== 'needs_review' && r.status !== 'running') {
    throw createError({ statusCode: 409, message: `run is ${r.status} — nothing to accept` })
  }

  await git(['add', '-A'], r.worktree)
  const dirty = (await git(['status', '--porcelain'], r.worktree)).trim()
  if (dirty) {
    await git(['commit', '-m', `${r.ticketKey} ${r.ticketTitle}`], r.worktree)
  }
  const ahead = Number((await git(['rev-list', '--count', `${ws.base}..HEAD`], r.worktree)).trim() || '0')
  if (!ahead) throw createError({ statusCode: 409, message: 'nothing to accept — no commits and a clean tree' })

  await git(['push', '-u', 'origin', r.branch], r.worktree)

  const ticket = await trackerTicket(r.ticketKey).catch(() => null)
  const body = [
    `Closes ${r.ticketKey} — dispatched and reviewed in jAgent.`,
    '',
    ticket?.resolution || r.resolution || '',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n')
  const bodyFile = join(runDir(r.id), 'pr-body.md')
  writeFileSync(bodyFile, body)
  const out = await run(
    'gh',
    ['pr', 'create', '--base', ws.base, '--head', r.branch, '--title', `${r.ticketKey} ${r.ticketTitle}`, '--body-file', bodyFile],
    r.worktree,
  )
  const prUrl = (out.trim().split('\n').pop() ?? '').trim()

  await trackerPatchTicket(r.ticketKey, { status: 'done', assignee: AGENT_NAME })

  await tmuxKill(r.session)
  await git(['worktree', 'remove', '--force', r.worktree], ws.repo, { okCodes: [1, 128] })

  const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1]
  const jdiffUrl = prNumber
    ? `https://jdiff.local/pr/${prNumber}?repo=${encodeURIComponent(ws.repo)}`
    : `https://jdiff.local/prs?repo=${encodeURIComponent(ws.repo)}`
  patchRun(r.id, { status: 'accepted', prUrl, needsYou: false })
  void fleetTick()
  return { prUrl, jdiffUrl }
}

export async function nudgeRun(runId: string, message: string): Promise<Run> {
  const state = loadAgentState()
  const r = findRun(state, runId)
  if (r.status !== 'running' && r.status !== 'needs_review') {
    throw createError({ statusCode: 409, message: `run is ${r.status} — nothing to nudge` })
  }
  // Feedback lands in both places: the ticket (durable) and the live session.
  await trackerComment(r.ticketKey, 'human (via jAgent)', message)
  await tmuxSendText(r.session, message)
  await tmuxSendKey(r.session, 'Enter')
  return patchRun(r.id, {
    status: 'running',
    resolutionSeen: r.resolution,
    needsYou: false,
    needsYouSince: null,
    lastActivityAt: nowIso(),
  })
}

export async function discardRun(runId: string): Promise<Run> {
  const state = loadAgentState()
  const r = findRun(state, runId)
  const ws = findWorkspace(state, r.workspaceId)
  if (!isLive(r) && r.status !== 'failed') {
    throw createError({ statusCode: 409, message: `run is ${r.status} — nothing to discard` })
  }
  await tmuxKill(r.session)
  await git(['worktree', 'remove', '--force', r.worktree], ws.repo, { okCodes: [1, 128] })
  await git(['branch', '-D', r.branch], ws.repo, { okCodes: [1] })
  const ticket = await trackerTicket(r.ticketKey).catch(() => null)
  if (ticket && ticket.status !== 'done' && ticket.assignee === AGENT_NAME) {
    await trackerPatchTicket(r.ticketKey, { assignee: '', status: 'todo' })
    await trackerComment(r.ticketKey, AGENT_NAME, `Run discarded in jAgent — releasing the ticket. The ${r.branch} worktree and branch were removed.`)
  }
  const updated = patchRun(r.id, { status: 'discarded', needsYou: false })
  void fleetTick()
  return updated
}

// ---------------------------------------------------------------------------
// Observers

export function patchRun(runId: string, patch: Partial<Run>): Run {
  return mutateAgentState((s) => {
    const r = findRun(s, runId)
    Object.assign(r, patch, { updatedAt: nowIso() })
    return r
  })
}

// Completion is observed, not reported: the agent's resolution landing on the
// ticket — over a stream jTicket already broadcasts — is what flips a run to
// needs_review. Process exit is not the signal (the session sits at a prompt),
// and pane-idle can't tell finished from thinking hard.
export async function checkCompletions(): Promise<void> {
  const state = loadAgentState()
  const active = state.runs.filter((r) => r.status === 'running' || r.status === 'needs_review')
  for (const r of active) {
    const ticket = await trackerTicket(r.ticketKey).catch(() => null)
    if (!ticket) continue
    const patch: Partial<Run> = {}
    if (ticket.title !== r.ticketTitle) patch.ticketTitle = ticket.title
    if (ticket.resolution !== r.resolution) patch.resolution = ticket.resolution
    if (r.status === 'running' && ticket.resolution.trim() && ticket.resolution !== r.resolutionSeen) {
      patch.status = 'needs_review'
      patch.needsYou = false
    }
    if (Object.keys(patch).length) patchRun(r.id, patch)
    if (patch.status === 'needs_review') void fleetTick() // the slot just freed
  }
}

// The permission-prompt sniff: claude's approval dialog always renders a
// numbered option list under a question. Pane text that stops changing only
// feeds the idle badge — it never drives state.
const paneHashes = new Map<string, string>()

// capture-pane -e keeps colour codes inline — strip them before matching or
// an escape sequence between "❯" and "1." defeats the pattern.
function stripAnsi(pane: string): string {
  // eslint-disable-next-line no-control-regex
  return pane.replace(/\x1b(?:\[[0-9;:?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '')
}

function looksLikePrompt(pane: string): boolean {
  const text = stripAnsi(pane)
  return /❯\s*1\./.test(text) || (/\b[Dd]o you want\b/.test(text) && /\b1\.\s/.test(text))
}

export async function scanPanes(): Promise<void> {
  const state = loadAgentState()
  const running = state.runs.filter((r) => r.status === 'running')
  if (!running.length) return
  if (!(await tmuxAvailable())) return
  const sessions = await tmuxSessions()
  for (const r of running) {
    if (!sessions.includes(r.session)) {
      patchRun(r.id, { status: 'failed', error: 'tmux session died — see the ticket comments / dispatch again' })
      continue
    }
    const pane = await tmuxCapture(r.session).catch(() => '')
    const hash = createHash('sha1').update(pane).digest('hex')
    const patch: Partial<Run> = {}
    if (paneHashes.get(r.id) !== hash) {
      paneHashes.set(r.id, hash)
      patch.lastActivityAt = nowIso()
    }
    const prompting = looksLikePrompt(pane)
    if (prompting && !r.needsYou) {
      patch.needsYou = true
      patch.needsYouSince = nowIso()
    } else if (!prompting && r.needsYou) {
      patch.needsYou = false
      patch.needsYouSince = null
    }
    if (Object.keys(patch).length) patchRun(r.id, patch)
  }
}

export async function refreshDiffStat(r: Run, base: string): Promise<Run> {
  try {
    const stat = await worktreeDiffStat({ kind: 'worktree', dir: r.worktree, base })
    if (JSON.stringify(stat) !== JSON.stringify(r.diffStat)) return patchRun(r.id, { diffStat: stat })
  } catch { /* worktree mid-setup or gone — keep the stale stat */ }
  return r
}

// ---------------------------------------------------------------------------
// Fleet mode: you fill the queue, the fleet drains it top-down. A slot is a
// running agent, not a worktree — needs_review frees the slot so the fleet
// flows at the agents' pace, while the (larger) worktree cap stops an
// unattended night producing fifty trees.

let draining = false

export async function fleetTick(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const state = loadAgentState()
    for (const ws of state.workspaces) {
      if (!ws.fleet || !ws.queue.length) continue
      const runs = state.runs.filter((r) => r.workspaceId === ws.id)
      let slots = ws.fleetSlots - runs.filter(holdsSlot).length
      let trees = ws.maxWorktrees - runs.filter(isLive).length
      for (const entry of [...ws.queue]) {
        if (slots <= 0 || trees <= 0) break
        if (entry.error) continue // failed once — skipped until the human edits the queue
        try {
          await dispatchTicket(ws.id, entry.key, entry.force)
          mutateAgentState((s) => {
            const w = findWorkspace(s, ws.id)
            w.queue = w.queue.filter((e) => e.key !== entry.key)
            w.updatedAt = nowIso()
          })
          slots -= 1
          trees -= 1
        } catch (err: any) {
          mutateAgentState((s) => {
            const w = findWorkspace(s, ws.id)
            const e = w.queue.find((q) => q.key === entry.key)
            if (e) e.error = String(err?.message ?? err)
            w.updatedAt = nowIso()
          })
        }
      }
    }
  } finally {
    draining = false
  }
}

// ---------------------------------------------------------------------------
// Boot reconcile: tmux owns the processes, not Nitro, so runs survive a
// jAgent restart — reconcile the records against `tmux ls` on the way up.

export async function reconcileRuns(): Promise<void> {
  const state = loadAgentState()
  const stale = state.runs.filter((r) => r.status === 'starting' || r.status === 'running')
  if (!stale.length) return
  const sessions = (await tmuxAvailable()) ? await tmuxSessions() : []
  for (const r of stale) {
    if (sessions.includes(r.session)) {
      if (r.status === 'starting') patchRun(r.id, { status: 'running' })
    } else if (r.status === 'starting') {
      patchRun(r.id, { status: 'failed', error: 'jAgent restarted mid-provision — discard and dispatch again' })
    } else {
      patchRun(r.id, { status: 'failed', error: 'tmux session gone after restart — discard and dispatch again' })
    }
  }
}
