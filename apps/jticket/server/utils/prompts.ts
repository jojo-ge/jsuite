// Per-project and per-ticket prompt overrides.
//
// Every hand-off jTicket makes — a ticket into herdr, a merge sweep — is a
// prompt built from a template. Three layers decide which template that is,
// each falling back to the one under it:
//
//   ticket.prompt (promptMode 'replace' | 'append')
//     → project.prompts[kind]
//       → store.promptDefaults[kind]        ← editable, PATCH /api/prompts
//         → the code default (app/utils/prompts.ts PROMPT_KIND_META)
//
// The rendering itself is the client's job (it owns the prompt-target picker
// and the placeholder vocabulary — app/utils/prompts.ts). The server's job is
// storage: a fixed set of kinds, trimmed text, capped length. Nothing here is
// interpreted, so an override can say anything a prompt can say.
//
// Overrides are MACHINE-LOCAL, like `repo` and `integrationBranch`: they
// describe how this machine dispatches agents, not what the work is. They are
// never put on the sync wire (see sync.ts, which names every field it exports)
// and they stay editable on both sides of a shared project.
//
// Pure logic, testable without Nuxt (prompts.test.ts).

/**
 * Every prompt jTicket fires, keyed by what picks it:
 * - `standard:*` — the three PR targets of the hand-off picker (an implementation ticket)
 * - `wayfinder` — a wayfinder frontier ticket
 * - `jmap:*` — a mapping job, picked by the ticket's `jmap:` label
 * - `todo` — a todo-list ticket's grilling
 * - `architect:*` — the architecture scan and a candidate's go/no-go grilling
 * - `predeploy` — a pre-deploy bug reproduction
 * - `merge` — the project-level merge sweep (not a ticket; project layer only)
 */
export const PROMPT_KINDS = [
  'standard:local',
  'standard:master',
  'standard:integration',
  'wayfinder',
  'jmap:scope',
  'jmap:domain',
  'jmap:synthesize',
  'todo',
  'architect:scan',
  'architect:grill',
  'predeploy',
  'merge',
] as const
export type PromptKind = (typeof PROMPT_KINDS)[number]

/** Only the kinds actually overridden are stored — an absent key means "fall through". */
export type PromptOverrides = Partial<Record<PromptKind, string>>

/**
 * How a ticket's own text is used: '' = not at all (the box is a draft, or was
 * emptied), 'append' = added after the resolved prompt, 'replace' = it IS the
 * prompt. Kept separate from the text so switching back to "use the project
 * prompt" doesn't throw away what you wrote.
 */
export type TicketPromptMode = '' | 'append' | 'replace'

/** A prompt is a terminal paste, not a document. */
export const PROMPT_TEXT_CAP = 8000

export function isPromptKind(v: unknown): v is PromptKind {
  return typeof v === 'string' && (PROMPT_KINDS as readonly string[]).includes(v)
}

export function coercePromptMode(v: unknown): TicketPromptMode {
  return v === 'append' || v === 'replace' ? v : ''
}

export function cleanPromptText(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, PROMPT_TEXT_CAP) : ''
}

/**
 * Apply a partial override patch on top of what is stored. PATCH semantics per
 * kind: absent leaves it alone, a non-empty string sets it, an empty string
 * (or any non-string) clears it back to the layer below. Unknown keys are
 * dropped rather than refused — a newer client naming a kind this build hasn't
 * heard of shouldn't 400 the whole save.
 */
export function mergePromptOverrides(current: PromptOverrides, patch: unknown): PromptOverrides {
  const next: PromptOverrides = { ...current }
  if (!patch || typeof patch !== 'object') return next
  const input = patch as Record<string, unknown>
  for (const kind of PROMPT_KINDS) {
    if (!(kind in input)) continue
    const text = cleanPromptText(input[kind])
    if (text) next[kind] = text
    else delete next[kind]
  }
  return next
}

/** The stored shape, with anything unrecognised (or empty) dropped. */
export function cleanPromptOverrides(input: unknown): PromptOverrides {
  return mergePromptOverrides({}, input)
}
