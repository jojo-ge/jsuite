// The live wire between the board and the store: an EventSource on
// /api/stream, and a diff of what came back so a change you did not make is
// visible rather than silent.
//
// The server only says "revision N" — everything below is the client working
// out what that meant, by comparing the tickets it had against the tickets it
// just fetched. That split is deliberate: the stream stays a dumb notification
// channel, and the interesting part (what counts as a move worth announcing)
// lives here, next to the UI that shows it.
import type { Ticket, TicketStatus } from '#shared/types/tracker'

export type LiveStatus = 'connecting' | 'live' | 'offline'

// One move per ticket, in the order the board cares about: a ticket that was
// created *and* claimed in the same revision reads as "created".
type Move =
  | { kind: 'created'; ticket: Ticket }
  | { kind: 'status'; ticket: Ticket; from: TicketStatus }
  | { kind: 'claimed'; ticket: Ticket }
  | { kind: 'released'; ticket: Ticket }
  | { kind: 'comment'; ticket: Ticket }
  | { kind: 'edited'; ticket: Ticket }

// Toasts are for moves worth looking up from what you are doing for; an edited
// description is not one, so it only gets the card highlight.
const ANNOUNCED: Move['kind'][] = ['created', 'status', 'claimed', 'released', 'comment']
const MAX_TOASTS = 4

export function diffTickets(before: Map<string, Ticket>, after: Ticket[]): Move[] {
  const moves: Move[] = []
  for (const ticket of after) {
    const was = before.get(ticket.id)
    if (!was) {
      moves.push({ kind: 'created', ticket })
      continue
    }
    // A new comment is worth announcing on its own terms — an agent asking a
    // question is the thing you most want pulled out of the page for.
    if (ticket.comments.length > was.comments.length) {
      moves.push({ kind: 'comment', ticket })
      continue
    }
    // Otherwise updatedAt is the cheap gate: no bump, nothing to compare.
    if (ticket.updatedAt === was.updatedAt) continue
    if (ticket.status !== was.status) {
      moves.push({ kind: 'status', ticket, from: was.status })
      continue
    }
    if (ticket.assignee !== was.assignee) {
      moves.push(ticket.assignee ? { kind: 'claimed', ticket } : { kind: 'released', ticket })
      continue
    }
    moves.push({ kind: 'edited', ticket })
  }
  return moves
}

interface ToastSpec {
  title: string
  description?: string
  icon: string
  color: 'primary' | 'info' | 'success' | 'warning' | 'neutral'
}

function toastFor(move: Move): ToastSpec | null {
  const t = move.ticket
  switch (move.kind) {
    case 'created':
      return { title: `${t.key} created`, description: t.title, icon: 'i-lucide-plus', color: 'primary' }
    case 'status':
      if (t.status === 'done') {
        return { title: `${t.key} done`, description: t.title, icon: 'i-lucide-circle-check', color: 'success' }
      }
      if (t.status === 'in_progress') {
        return {
          title: `${t.key} started${t.assignee ? ` by ${t.assignee}` : ''}`,
          description: t.title,
          icon: 'i-lucide-loader',
          color: 'info',
        }
      }
      return { title: `${t.key} back to To Do`, description: t.title, icon: 'i-lucide-undo-2', color: 'neutral' }
    case 'claimed':
      return {
        title: `${t.key} claimed by ${t.assignee}`,
        description: t.title,
        icon: 'i-lucide-user-round',
        color: 'primary',
      }
    case 'released':
      return { title: `${t.key} unclaimed`, description: t.title, icon: 'i-lucide-user-round-x', color: 'neutral' }
    case 'comment': {
      const last = t.comments[t.comments.length - 1]
      return {
        title: `${last?.author ?? 'Someone'} commented on ${t.key}`,
        description: markdownPreview(last?.body ?? '').slice(0, 120),
        icon: 'i-lucide-message-square',
        color: 'warning',
      }
    }
    default:
      return null
  }
}

// Just the shared connection state — for anything that wants to *show* whether
// the board is live (the header dot) without opening a second EventSource.
export function useLiveStatus() {
  const status = useState<LiveStatus>('jticket-live-status', () => 'connecting')
  // When the board last actually moved, as a client timestamp.
  const lastChangeAt = useState<number | null>('jticket-live-change', () => null)
  return { status, lastChangeAt }
}

export function useLiveTracker() {
  const { tickets, refresh, markChanged } = useTracker()
  const { status, lastChangeAt } = useLiveStatus()
  const toast = useToast()

  let source: EventSource | null = null
  let greeted = false
  let pulling = false
  let queued = false

  function announce(moves: Move[]) {
    const worth = moves.filter((m) => ANNOUNCED.includes(m.kind))
    for (const move of worth.slice(0, MAX_TOASTS)) {
      const spec = toastFor(move)
      if (spec) toast.add({ ...spec, duration: 6000 })
    }
    const extra = worth.length - MAX_TOASTS
    if (extra > 0) {
      toast.add({
        title: `and ${extra} more ${extra === 1 ? 'ticket' : 'tickets'} moved`,
        icon: 'i-lucide-activity',
        color: 'neutral',
        duration: 6000,
      })
    }
  }

  // Refetch and work out what changed. Overlapping notifications collapse into
  // one more pass rather than one more fetch — a bulk import trips the watcher
  // several times over.
  async function pull(): Promise<void> {
    if (pulling) {
      queued = true
      return
    }
    pulling = true
    try {
      do {
        queued = false
        const before = new Map(tickets.value.map((t) => [t.id, t]))
        await refresh()
        const moves = diffTickets(before, tickets.value)
        if (!moves.length) continue
        markChanged(moves.map((m) => m.ticket.id))
        lastChangeAt.value = Date.now()
        announce(moves)
      } while (queued)
    } catch {
      // A failed refetch is not a failed connection — the next revision (or the
      // next time the tab is focused) tries again.
    } finally {
      pulling = false
    }
  }

  function connect(): void {
    if (!import.meta.client || source) return
    status.value = 'connecting'
    source = new EventSource('/api/stream')

    source.onopen = () => {
      status.value = 'live'
    }
    source.onerror = () => {
      // EventSource reconnects by itself; CLOSED is the only state where it has
      // given up, and that only happens once the server is gone for good.
      status.value = source?.readyState === EventSource.CLOSED ? 'offline' : 'connecting'
    }
    source.onmessage = (e) => {
      let msg: { kind?: string }
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      status.value = 'live'
      // Revision numbers are per-connection — a server restart resets them — so
      // a second hello means "you may have missed something", not a number to
      // compare against.
      if (msg.kind === 'hello') {
        if (greeted) void pull()
        greeted = true
        return
      }
      if (msg.kind === 'change') void pull()
    }
  }

  function disconnect(): void {
    source?.close()
    source = null
  }

  // A laptop that slept can hold a connection the browser still thinks is open,
  // so coming back to the tab re-checks rather than trusting it.
  function onVisible(): void {
    if (document.visibilityState !== 'visible') return
    if (!source || source.readyState === EventSource.CLOSED) {
      disconnect()
      connect()
      return
    }
    void pull()
  }

  // Started once, by app.vue, for the whole app — and stopped by it, rather
  // than by a scope hook, so the pairing is visible where it is mounted.
  function start(): void {
    if (!import.meta.client) return
    connect()
    document.addEventListener('visibilitychange', onVisible)
  }

  function stop(): void {
    if (!import.meta.client) return
    document.removeEventListener('visibilitychange', onVisible)
    disconnect()
  }

  return { status, lastChangeAt, start, stop, pull }
}
