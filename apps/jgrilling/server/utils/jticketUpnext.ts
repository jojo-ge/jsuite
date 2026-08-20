// The jTicket side of jGrilling's "Up next" strip: the frontier's HITL
// grilling tickets (label `wayfinder:grilling`), grouped by project the same
// way jTicket's own /next page groups them. jGrilling only reads — claiming,
// resolving and all other ticket state stay jTicket's.
const JTICKET = process.env.JTICKET_URL || 'http://localhost:43000'

export interface UpnextProject {
  id: string
  key: string
  title: string
  mode: string
}

export interface UpnextTicket {
  id: string
  key: string
  title: string
  description: string
  acCount: number
}

export interface UpnextGroup {
  project: UpnextProject | null
  tickets: UpnextTicket[]
}

export function jticketUrl(path: string): string {
  return `${JTICKET}${path}`
}

export async function fetchGrillingFrontier(): Promise<UpnextGroup[]> {
  const [tickets, projects] = await Promise.all([
    $fetch<any[]>(jticketUrl('/api/tickets'), { query: { frontier: 'true' }, timeout: 3000 }),
    $fetch<any[]>(jticketUrl('/api/projects'), { timeout: 3000 }),
  ])

  const grillings = tickets.filter(
    (t) => t.type === 'HITL' && (t.labels ?? []).includes('wayfinder:grilling'),
  )
  const row = (t: any): UpnextTicket => ({
    id: t.id,
    key: t.key,
    title: t.title,
    description: String(t.description ?? ''),
    acCount: (t.acceptanceCriteria ?? []).length,
  })

  // One group per project that has a grilling ready, in project order, loose
  // tickets last — the same shape jTicket's /next page renders.
  const byProject = new Map<string, any[]>()
  const loose: any[] = []
  for (const t of grillings) {
    if (!t.projectId) loose.push(t)
    else if (byProject.has(t.projectId)) byProject.get(t.projectId)!.push(t)
    else byProject.set(t.projectId, [t])
  }

  const out: UpnextGroup[] = []
  for (const p of projects) {
    const ready = byProject.get(p.id)
    if (!ready) continue
    out.push({
      project: { id: p.id, key: p.key, title: p.title, mode: String(p.mode ?? 'standard') },
      tickets: ready.map(row),
    })
  }
  if (loose.length) out.push({ project: null, tickets: loose.map(row) })
  return out
}
