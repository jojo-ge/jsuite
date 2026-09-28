// The jButton's forecast — how many loops auto mode would run from here, and
// which loop each open ticket would land in. Pure: no Nuxt, no I/O —
// tests/autoForecast.test.ts. The page adapts its tickets in
// composables/useAutoLoop.ts (autoForecastFor).
//
// It replays the loop's frontier rule (see utils/autoLoop.ts) over the blocker
// graph, assuming every ticket a loop dispatches finishes within that loop:
//
//   loop 1   the loop in progress, or — between loops — the AFK frontier now
//   loop n+1 every AFK ticket whose blockers are all finished by the end of
//            loop n (what's running now — claimed by hand, or the peer's —
//            counts as finished by the end of loop 1)
//
// HITL tickets are never dispatched, and neither is anything only the other
// side of a shared project can start; those, and everything waiting on them
// (or on another project's unstarted work), are `gated` — no loop reaches
// them until a human moves first. The review's fix tickets can't be known
// ahead of time, so they ride inside their loop and never add one.

export interface ForecastTicket {
  id: string
  /** This project's — only these land in a loop. Blockers from elsewhere ride along as context. */
  inProject: boolean
  /** Not done/merged. */
  open: boolean
  hitl: boolean
  /** The loop could hand it to herdr once unblocked: todo, unclaimed, ours. */
  takeable: boolean
  /** Open and already moving — claimed, in progress (ours or the peer's). */
  running: boolean
  /** Blocker ids. */
  blockedBy: string[]
}

export interface AutoForecast {
  /** Ticket ids per loop, in order. */
  loops: string[][]
  /** Open project tickets no loop reaches — HITL, the peer's, or waiting on one of those. */
  gated: string[]
}

/**
 * @param current the loop in progress' tickets — it is loop 1; omit between
 *   loops (or with auto off), when loop 1 is the AFK frontier as it stands.
 */
export function forecastLoops(tickets: ForecastTicket[], current: string[] = []): AutoForecast {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const settled = new Set(tickets.filter((t) => !t.open).map((t) => t.id))
  const eligible = (t: ForecastTicket) => t.inProject && t.open && !t.hitl && t.takeable && !settled.has(t.id)
  // A blocker we know nothing about can't hold a ticket (isBlocked agrees).
  const unblocked = (t: ForecastTicket) => t.blockedBy.every((b) => settled.has(b) || !byId.has(b))

  const loops: string[][] = []
  const first = current.length ? current.filter((id) => byId.get(id)?.inProject) : tickets.filter((t) => eligible(t) && unblocked(t)).map((t) => t.id)
  if (first.length) loops.push(first)
  for (const id of first) settled.add(id)
  for (const t of tickets) if (t.open && t.running) settled.add(t.id)

  for (;;) {
    const wave = tickets.filter((t) => eligible(t) && unblocked(t)).map((t) => t.id)
    if (!wave.length) break
    loops.push(wave)
    for (const id of wave) settled.add(id)
  }

  const gated = tickets.filter((t) => t.inProject && t.open && !settled.has(t.id)).map((t) => t.id)
  return { loops, gated }
}

/** Which loop (1-based) a ticket lands in, 0 when it's gated or not in the forecast. */
export function forecastLoopOf(forecast: AutoForecast, id: string): number {
  return forecast.loops.findIndex((wave) => wave.includes(id)) + 1
}
