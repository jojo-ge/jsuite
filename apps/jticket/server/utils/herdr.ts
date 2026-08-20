// Driving Herdr (the terminal workspace manager) from jTicket.
//
// The adapter itself lives in @jsuite/herdr (shared with jMap): binary
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
import { acquirePackedPane } from '@jsuite/herdr'

export {
  HerdrError,
  herdrJson,
  herdrState,
  invalidateHerdrState,
  ensureHerdrWorkspace,
  createJobTab,
  focusHerdrWindow,
  startClaudeIn,
} from '@jsuite/herdr'
export type { HerdrTab, HerdrWorkspace, HerdrState } from '@jsuite/herdr'

/**
 * A shell pane for a ticket: the first ticket tab (label = project key, then
 * 'KEY · 2', …) with room, split 2×2-wise; a fresh tab when they're all full.
 * Merge tabs ('KEY · merge…') are never packed with ticket panes — the packed
 * tab regex only matches 'KEY' / 'KEY · <number>'.
 */
export const acquireTicketPane = acquirePackedPane
