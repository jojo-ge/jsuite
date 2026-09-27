// Project graphs — what the Graphs page draws. There is no graph entity: two
// projects are linked when a ticket in one is blocked by a ticket in the
// other (A → B: B's ticket waits on A's), and a graph is each connected group
// of linked projects. Add or drop a cross-project blocker and the graphs
// follow. Pure: no Nuxt, no I/O — tests/projectGraphs.test.ts.
import { OUTCOME_LABEL } from './autoLoop'

export interface GraphProject {
  id: string
  key: string
  title: string
  createdAt: string
}

export interface GraphTicket {
  id: string
  key: string
  projectId: string | null
  blockedBy: string[]
}

export interface GraphDoc {
  id: string
  key: string
  projectId: string | null
  labels: string[]
  updatedAt: string
}

/** A → B, and the ticket pairs behind it (blocker in A, blocked in B). */
export interface ProjectLink {
  from: string
  to: string
  pairs: Array<{ blocker: string; blocked: string }>
}

export interface ProjectGraph {
  /** Stable while the membership holds: the earliest-created member's id. */
  id: string
  /** "Start, Start → End, End" — the projects nothing leads into, then the ones that lead nowhere. */
  name: string
  /** Member project ids, in layer order (then creation order). */
  projects: string[]
  links: ProjectLink[]
  /** projectId → column: 0 for a start, else one past its furthest predecessor. */
  layer: Record<string, number>
  starts: string[]
  ends: string[]
}

/** Every graph of linked projects, earliest-started first. Unlinked projects appear in none. */
export function projectGraphs(projects: GraphProject[], tickets: GraphTicket[]): ProjectGraph[] {
  const byProject = new Map(projects.map((p) => [p.id, p]))
  const projectOf = new Map(tickets.map((t) => [t.id, t.projectId]))
  const ticketKey = new Map(tickets.map((t) => [t.id, t.key]))

  // Collect cross-project edges, one link per ordered project pair.
  const links = new Map<string, ProjectLink>()
  for (const t of tickets) {
    if (!t.projectId || !byProject.has(t.projectId)) continue
    for (const b of t.blockedBy) {
      const from = projectOf.get(b)
      if (!from || from === t.projectId || !byProject.has(from)) continue
      const id = `${from}>${t.projectId}`
      const link = links.get(id) ?? { from, to: t.projectId, pairs: [] }
      link.pairs.push({ blocker: ticketKey.get(b)!, blocked: t.key })
      links.set(id, link)
    }
  }

  // Connected components over the links, ignoring direction.
  const adj = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b)
  for (const l of links.values()) {
    touch(l.from, l.to)
    touch(l.to, l.from)
  }
  const created = (id: string) => byProject.get(id)!.createdAt
  const byCreated = (a: string, b: string) => created(a).localeCompare(created(b)) || a.localeCompare(b)
  const seen = new Set<string>()
  const graphs: ProjectGraph[] = []
  for (const start of [...adj.keys()].sort(byCreated)) {
    if (seen.has(start)) continue
    const members: string[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const id = queue.shift()!
      members.push(id)
      for (const n of adj.get(id) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n)
    }
    const mine = [...links.values()].filter((l) => members.includes(l.from))
    graphs.push(shapeGraph(members.sort(byCreated), mine, byProject, byCreated))
  }
  return graphs
}

function shapeGraph(
  members: string[],
  links: ProjectLink[],
  byProject: Map<string, GraphProject>,
  byCreated: (a: string, b: string) => number,
): ProjectGraph {
  const into = (id: string) => links.filter((l) => l.to === id).map((l) => l.from)
  const outOf = (id: string) => links.filter((l) => l.from === id).map((l) => l.to)

  // A graph that is all cycle has no clean start or end — name (and anchor)
  // it from its earliest-created project instead.
  let starts = members.filter((id) => !into(id).length)
  let ends = members.filter((id) => !outOf(id).length)
  if (!starts.length) starts = [members[0]!]
  if (!ends.length) ends = [members.at(-1)!]
  const titles = (ids: string[]) => ids.map((id) => byProject.get(id)!.title).join(', ')

  // Longest path from a start. Cycle-safe: a project met again while its own
  // layer is being worked out counts as a start.
  const layer: Record<string, number> = Object.fromEntries(starts.map((id) => [id, 0]))
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    if (id in layer) return layer[id]!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const preds = into(id)
    const d = preds.length ? 1 + Math.max(...preds.map(layerOf)) : 0
    visiting.delete(id)
    return (layer[id] = d)
  }
  members.forEach(layerOf)

  return {
    id: members[0]!,
    name: `${titles(starts)} → ${titles(ends)}`,
    projects: [...members].sort((a, b) => layer[a]! - layer[b]! || byCreated(a, b)),
    links: links.map((l) => ({ ...l, pairs: [...l.pairs].sort((a, b) => a.blocked.localeCompare(b.blocked, undefined, { numeric: true })) })),
    layer,
    starts,
    ends,
  }
}

/** A project's outcome report — its latest 'outcome'-labelled doc, or null. */
export function outcomeDocOf<D extends GraphDoc>(docs: D[], projectId: string): D | null {
  return (
    docs
      .filter((d) => d.projectId === projectId && d.labels.includes(OUTCOME_LABEL))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  )
}
