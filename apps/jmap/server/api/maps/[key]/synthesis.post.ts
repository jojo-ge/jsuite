import type { MapEdge, MapNode, MapSynthesis } from '../../../../app/utils/mapTypes'

const NODE_KINDS = new Set(['component', 'route', 'store', 'service', 'model', 'util', 'external', 'domain'])
const EDGE_KINDS = new Set(['imports', 'calls', 'renders', 'data', 'http', 'depends'])

/**
 * The synthesis hand-back — what a `/jmap-synthesize` herdr session POSTs when
 * it has unified the domain docs into the system graph:
 *   { nodes, edges, groups, nodeNotes, commentary }
 *
 * Validated the way the docs promise: unknown node kinds fall back, edges
 * pointing at unknown nodes are dropped (count returned), domain nodes are
 * paired with their walkthrough documents via the ticket-key labels on the
 * project's jmap:domain docs. Storing the graph flips the map to `done`;
 * re-POSTs replace it wholesale.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const map = await readMap(key)
  if (!map) throw createError({ statusCode: 404, message: `No such map: ${key}` })

  const body = (await readBody(event)) ?? {}

  // Ticket-key → documentKey, from the docs' labels, so domain nodes link to
  // their walkthroughs without the poster having to know doc keys.
  const docByTicket = new Map<string, string>()
  try {
    const { docs } = await fetchJmapProject(map.projectKey)
    for (const d of docs.filter((x) => x.labels.includes('jmap:domain'))) {
      const tick = d.labels.find((l) => /^tick-\d+$/i.test(l))
      if (tick) docByTicket.set(tick.toUpperCase(), d.documentKey)
    }
  } catch {
    // jTicket down mid-POST: accept the graph anyway, just without doc links.
  }

  const nodes: MapNode[] = (Array.isArray(body.nodes) ? body.nodes : [])
    .map((n: any): MapNode => {
      const ticketKey = typeof n?.ticketKey === 'string' && /^TICK-\d+$/i.test(n.ticketKey.trim())
        ? n.ticketKey.trim().toUpperCase()
        : undefined
      return {
        id: String(n?.id ?? '').trim(),
        label: String(n?.label ?? '').trim(),
        kind: NODE_KINDS.has(n?.kind) ? n.kind : 'external',
        ticketKey,
        documentKey: ticketKey ? docByTicket.get(ticketKey) : undefined,
        summary: n?.summary ? String(n.summary).slice(0, 300) : undefined,
      }
    })
    .filter((n: MapNode) => n.id && n.label)
  if (!nodes.length) throw createError({ statusCode: 400, message: 'synthesis has no usable nodes' })
  const nodeIds = new Set(nodes.map((n) => n.id))

  const rawEdges: any[] = Array.isArray(body.edges) ? body.edges : []
  const edges: MapEdge[] = rawEdges
    .map((e: any): MapEdge => ({
      from: String(e?.from ?? '').trim(),
      to: String(e?.to ?? '').trim(),
      kind: EDGE_KINDS.has(e?.kind) ? e.kind : 'depends',
      description: e?.description ? String(e.description).slice(0, 300) : undefined,
    }))
    .filter((e: MapEdge) => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to)
  const droppedEdges = rawEdges.length - edges.length

  const groups = (Array.isArray(body.groups) ? body.groups : [])
    .map((g: any) => ({
      id: sanitizeMapKey(g?.id ?? g?.label),
      label: String(g?.label ?? '').trim(),
      nodeIds: (Array.isArray(g?.nodeIds) ? g.nodeIds : []).map(String).filter((v: string) => nodeIds.has(v)),
    }))
    .filter((g: any) => g.id && g.label && g.nodeIds.length)

  const nodeNotes: Record<string, string> = {}
  if (body.nodeNotes && typeof body.nodeNotes === 'object') {
    for (const [nid, md] of Object.entries(body.nodeNotes)) {
      if (nodeIds.has(nid) && typeof md === 'string' && md.trim()) nodeNotes[nid] = md
    }
  }

  const synthesis: MapSynthesis = {
    nodes,
    edges,
    groups,
    commentary: String(body.commentary ?? ''),
    nodeNotes,
    generatedAt: new Date().toISOString(),
  }
  map.synthesis = synthesis
  map.status = 'done'
  await writeMap(map)

  return {
    ok: true,
    nodes: nodes.length,
    edges: edges.length,
    groups: groups.length,
    droppedEdges,
    url: `https://jmap.local/m/${map.key}`,
  }
})
