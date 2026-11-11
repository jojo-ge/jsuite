// Driving Herdr (the terminal workspace manager) from jTicket.
//
// The adapter itself lives in @jsuite/herdr (shared with jDiff and jReview): binary
// resolution, JSON exec, state cache, workspace/tab/pane topology, agent
// start with its retry dance. Re-exported here so Nitro auto-imports keep
// working for the herdr routes. jTicket's own topology choices: one workspace
// per project (label = project title, cwd = the repo), ticket work as panes
// packed up to four per 'PROJ-n' tab, merge jobs as their own single-pane tab
// ('PROJ-2 · merge'). Everything created --no-focus; focus moves only through
// the explicit focus endpoint.
//
// Everything degrades: no herdr binary or no running server ⇒ state reports
// { available: false } and the UI hides the buttons.
//
// The four calls that create panes or talk to claude are wrapped here for
// sandbox mode (server/utils/sandbox.ts): a sandbox makes panes only in its
// writable repos, and every prompt it sends — and every session it starts —
// is pointed back at the sandbox's own jTicket. Outside a sandbox the
// wrappers pass straight through.
import * as herdr from '@jsuite/herdr'
import { assertDispatchAllowed, sessionClaudeArgs, sessionPrompt } from './sandbox'

export {
  HerdrError,
  herdrJson,
  herdrState,
  invalidateHerdrState,
  renamePane,
  focusHerdrWindow,
  withHerdrLock,
} from '@jsuite/herdr'
export type { HerdrTab, HerdrWorkspace, HerdrState } from '@jsuite/herdr'

export function ensureHerdrWorkspace(label: string, cwd: string) {
  assertDispatchAllowed(cwd)
  return herdr.ensureHerdrWorkspace(label, cwd)
}

export function createJobTab(workspaceId: string, baseLabel: string, cwd: string) {
  assertDispatchAllowed(cwd)
  return herdr.createJobTab(workspaceId, baseLabel, cwd)
}

export function startClaudeIn(paneId: string, name: string, prompt: string, opts: { args?: string[] } = {}) {
  return herdr.startClaudeIn(paneId, name, sessionPrompt(prompt), { ...opts, args: [...(opts.args ?? []), ...sessionClaudeArgs()] })
}

export function submitPrompt(agentName: string, prompt: string) {
  return herdr.submitPrompt(agentName, sessionPrompt(prompt))
}

/**
 * A shell pane for a ticket: the first ticket tab (label = project key, then
 * 'KEY · 2', …) with room, split 2×2-wise; a fresh tab when they're all full.
 * Merge tabs ('KEY · merge…') are never packed with ticket panes — the packed
 * tab regex only matches 'KEY' / 'KEY · <number>'.
 */
export function acquireTicketPane(workspaceId: string, baseLabel: string, cwd: string, freshTab: { tabId: string; paneId: string } | null) {
  assertDispatchAllowed(cwd)
  return herdr.acquirePackedPane(workspaceId, baseLabel, cwd, freshTab)
}
