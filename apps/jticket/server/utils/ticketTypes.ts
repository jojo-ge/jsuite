// Ticket types and tags.
//
// Every ticket has exactly one main `type` — what kind of work it is — and a
// few well-known tags carried in its `labels`:
//
//   afk | hitl   exactly one, always: can an agent take it end to end, or will
//                it stop and need the human? HITL tickets get their own herdr tab.
//   prototype    throwaway work that must never ship; combines with any type.
//
// Before types existed, `type` held 'AFK' | 'HITL' and wayfinder tickets carried
// their sub-type as a `wayfinder:<research|prototype|grilling|task>` label.
// normalizeTicketKind folds both legacy shapes into the current one, so every
// write path (create, patch, import, sync from a not-yet-updated peer) and the
// store loader can pass whatever arrived through it. `./jsuite setup` runs
// scripts/migrate-ticket-types.ts, which persists the same fold over the file.
//
// Import-free on purpose: the setup migration runs this module standalone.

export type TicketType = 'story' | 'task' | 'bug' | 'review' | 'verification' | 'research' | 'decision' | 'docs'

export const TICKET_TYPES: TicketType[] = ['story', 'task', 'bug', 'review', 'verification', 'research', 'decision', 'docs']

export type AgencyTag = 'afk' | 'hitl'
export type TicketTag = AgencyTag | 'prototype'

export const TICKET_TAGS: TicketTag[] = ['afk', 'hitl', 'prototype']

export function isTicketType(v: unknown): v is TicketType {
  return TICKET_TYPES.includes(v as TicketType)
}

// The legacy wayfinder sub-types, as the type (and tag) each became.
const WAYFINDER_LEGACY: Record<string, { type: TicketType; prototype?: true }> = {
  research: { type: 'research' },
  prototype: { type: 'research', prototype: true },
  grilling: { type: 'decision' },
  task: { type: 'task' },
}
const WAYFINDER_LABEL = /^wayfinder:(research|prototype|grilling|task)$/

// The type a ticket should get when nobody named one: what its mode labels
// say it is, else what its project's mode makes it. Mode is a plain string so
// this module stays import-free.
export function defaultTicketType(labels: readonly string[], projectMode?: string | null): TicketType {
  if (labels.includes('arch:scan')) return 'research'
  if (labels.includes('arch:candidate')) return 'decision'
  if (labels.some((l) => l.startsWith('jmap:'))) return 'docs'
  if (labels.includes('review:finding')) return 'bug'
  if (projectMode === 'jmap') return 'docs'
  if (projectMode === 'predeploy') return 'bug'
  return 'task'
}

// Fold whatever arrived into { type, labels } with exactly one agency tag and
// no legacy wayfinder label. `type` wins when it's a real type; a legacy
// 'AFK' / 'HITL' there sets the agency tag instead. `fallback` is the type to
// keep when neither the type nor a wayfinder label names one (a PATCH passes
// the ticket's current type; a create passes defaultTicketType).
export function normalizeTicketKind(
  input: { type?: unknown; labels?: readonly string[] },
  fallback: TicketType,
): { type: TicketType; labels: string[] } {
  let type: TicketType | null = isTicketType(input.type) ? input.type : null
  let prototype = false
  const labels: string[] = []
  for (const l of input.labels ?? []) {
    const m = WAYFINDER_LABEL.exec(l)
    if (!m) {
      if (!labels.includes(l)) labels.push(l)
      continue
    }
    const legacy = WAYFINDER_LEGACY[m[1]!]!
    type ??= legacy.type
    if (legacy.prototype) prototype = true
  }
  if (prototype && !labels.includes('prototype')) labels.push('prototype')

  // Agency: an explicit hitl tag or a legacy HITL type makes it HITL; anything
  // else is AFK. Exactly one of the pair survives.
  const hitl = labels.includes('hitl') || input.type === 'HITL'
  const rest = labels.filter((l) => l !== 'afk' && l !== 'hitl')
  return { type: type ?? fallback, labels: [hitl ? 'hitl' : 'afk', ...rest] }
}

export function isHitl(ticket: { labels?: readonly string[] }): boolean {
  return (ticket.labels ?? []).includes('hitl')
}

// A stored ticket still in a pre-types shape — what the setup migration and
// the loader look for.
export function isLegacyTicket(t: { type?: unknown; labels?: readonly string[] }): boolean {
  const labels = t.labels ?? []
  return (
    !isTicketType(t.type) ||
    labels.some((l) => WAYFINDER_LABEL.test(l)) ||
    labels.filter((l) => l === 'afk' || l === 'hitl').length !== 1
  )
}
