// The rules read off jTicket's records — shared, like the shapes next door in
// shared/types/tracker.ts, and for the same reason. The board computes the
// frontier locally from the tickets it already holds; `?frontier=true` computes
// it server-side for agents. Two copies of that rule is two answers to "what
// can I take next?", so there is one, here, and both sides call it.
//
// Everything here is a pure function of the records — no store, no fetch, no
// view meta. Auto-imported on both sides (`shared/utils/`), so call sites just
// use the names.
import type { Attachment, Ticket, TicketDerived, WayfinderType } from '#shared/types/tracker'

// ── Derived ticket state (wayfinder) ────────────────────────────────────────
// A ticket is blocked while any ticket it depends on is not yet done.
export function isBlocked(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.blockedBy.some((id) => {
    const dep = all.find((t) => t.id === id)
    return dep ? dep.status !== 'done' : false
  })
}

// The frontier: the takeable edge of a map — open, unblocked, and unclaimed.
export function isFrontier(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.status === 'todo' && !ticket.assignee && !isBlocked(ticket, all)
}

// GET responses augment each ticket with derived flags so callers (agents)
// never have to recompute the frontier. Never persisted — computed per request.
// Only the server calls this; it lives here because it is the one definition of
// what those flags mean, next to the rules that answer them.
export function withDerived(ticket: Ticket, all: Ticket[]): Ticket & TicketDerived {
  return {
    ...ticket,
    blocked: isBlocked(ticket, all),
    claimed: !!ticket.assignee,
    frontier: isFrontier(ticket, all),
  }
}

// ── Ordering ────────────────────────────────────────────────────────────────
// Newest completion first — the order "Recently finished" reads in. Tickets
// with no stamp (never finished) sort last.
export function byCompletedAtDesc(a: Ticket, b: Ticket): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
}

// Order by the numeric suffix of the key (TICK-9 before TICK-10) — the order
// wayfinder walks the frontier in, and the order every ticket list reads in.
// Anything that doesn't end in a number sorts as 0 rather than poisoning the
// comparator with NaN, which would leave the whole list in an arbitrary order.
export function byKeyNumber(a: { key: string }, b: { key: string }): number {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return n(a.key) - n(b.key)
}

// ── Wayfinder sub-types ─────────────────────────────────────────────────────
// The sub-type lives in a ticket's labels as 'wayfinder:<type>'. This is the
// one place that knows that encoding: the picker builds a label with
// wayfinderLabel(), every reader parses one back with wayfinderTypeOfLabel(),
// and /api/import validates what it was handed with isWayfinderType() rather
// than writing a label no screen can render.
export const WAYFINDER_TYPES: WayfinderType[] = ['research', 'prototype', 'grilling', 'task']

export function isWayfinderType(v: unknown): v is WayfinderType {
  return WAYFINDER_TYPES.includes(v as WayfinderType)
}

/** 'research' → 'wayfinder:research' — the label a ticket actually carries. */
export function wayfinderLabel(type: WayfinderType): string {
  return `wayfinder:${type}`
}

/** 'wayfinder:research' → 'research'; anything else (including an unknown sub-type) → null. */
export function wayfinderTypeOfLabel(label: string): WayfinderType | null {
  const rest = label.startsWith('wayfinder:') ? label.slice('wayfinder:'.length) : null
  return isWayfinderType(rest) ? rest : null
}

/** A ticket's sub-type: the first 'wayfinder:<type>' label it carries, if any. */
export function wayfinderType(ticket: Pick<Ticket, 'labels'>): WayfinderType | null {
  for (const l of ticket.labels ?? []) {
    const type = wayfinderTypeOfLabel(l)
    if (type) return type
  }
  return null
}

// ── Attachments ─────────────────────────────────────────────────────────────
/** The stable identity of a ref — `type:id`, the key every list, map and dedupe uses. */
export function attachmentKey(a: Attachment): string {
  return `${a.type}:${a.id}`
}
