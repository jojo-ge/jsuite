// The claude models jTicket pins its herdr sessions to. Only the auto loop
// pins — a hand dispatch still runs whatever the claude CLI defaults to.

/** Auto-loop implementation and fix sessions — the latest Opus. */
export const IMPLEMENT_MODEL = process.env.JTICKET_IMPLEMENT_MODEL?.trim() || 'claude-opus-5-5'

/** Auto-loop merge sweeps — the latest Sonnet: rebasing and POSTing merges. */
export const MERGE_MODEL = process.env.JTICKET_MERGE_MODEL?.trim() || 'claude-sonnet-5'
