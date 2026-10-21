import { outcomeDocOf, projectGraphs, type ProjectGraph } from '../../app/utils/projectGraphs'
import type { Store } from './store'

/** Every project graph, keyed by project key instead of internal id — what the API hands out. */
export function graphsView(store: Store) {
  const byId = new Map(store.projects.map((p) => [p.id, p]))
  const key = (id: string) => byId.get(id)?.key ?? id
  return projectGraphs(store.projects, store.tickets).map((g: ProjectGraph) => ({
    id: g.id,
    name: g.name,
    url: `/graphs?g=${g.id}`,
    projects: g.projects.map((id) => {
      const mine = store.tickets.filter((t) => t.projectId === id)
      return {
        key: key(id),
        title: byId.get(id)?.title ?? '',
        layer: g.layer[id],
        tickets: mine.length,
        finished: mine.filter((t) => t.status === 'done' || t.status === 'merged').length,
        outcomeDoc: outcomeDocOf(store.docs, id)?.key ?? null,
      }
    }),
    links: g.links.map((l) => ({ from: key(l.from), to: key(l.to), pairs: l.pairs })),
    starts: g.starts.map(key),
    ends: g.ends.map(key),
  }))
}
