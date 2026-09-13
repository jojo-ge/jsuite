// Driving Herdr (the terminal workspace manager) from jCode.
//
// jCode runs NO claude of its own. Two sessions touch a kata, and both are
// interactive claude sessions in a terminal:
//   - the BUILD session (skill `jcode`) — built the feature, held the piece
//     back, and POSTed the kata here; it isn't dispatched by this app.
//   - the MARKING session (skill `jcode-mark`) — dispatched into herdr by the
//     Mark-it button: one workspace per repo, one single-pane job tab per
//     attempt. It reads the kata (answer included) off /full, checks the
//     human's code, runs the tests, and POSTs a verdict back to
//     /api/katas/:key/attempts/:id/mark.
//
// The adapter itself lives in @jsuite/herdr (shared with jTicket, jMap and
// jDiff). Re-exported here so Nitro auto-imports pick the names up. Dispatch
// focuses the new tab but not the window: the human is watching the kata
// page, where the verdict streams in.

export {
  HerdrError,
  herdrJson,
  herdrState,
  invalidateHerdrState,
  ensureHerdrWorkspace,
  createJobTab,
  renamePane,
  focusHerdrWindow,
  startClaudeIn,
} from '@jsuite/herdr'

/** Optional model pin for marking sessions (e.g. `claude-opus-5`); default = the claude default. */
export const MARK_MODEL = process.env.JCODE_MARK_MODEL?.trim() || ''
