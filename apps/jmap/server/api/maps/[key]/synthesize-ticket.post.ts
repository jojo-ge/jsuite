/**
 * The Synthesize button: create the synthesis TICKET on the jTicket project
 * (label jmap:synthesize → the Run button on /next dispatches
 * `/jmap-synthesize TICK-n` into herdr). The session it starts reads the
 * domain docs, builds the graph, and hands it back via
 * POST /api/maps/:key/synthesis — jMap runs nothing itself.
 *
 * Idempotent-ish: an unfinished synthesis ticket is returned instead of
 * duplicated; a finished one (re-synthesis) gets a fresh ticket.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const map = await readMap(key)
  if (!map) throw createError({ statusCode: 404, message: `No such map: ${key}` })

  const { tickets, docs } = await fetchJmapProject(map.projectKey)
  const domainDocs = docs.filter((d) => d.labels.includes('jmap:domain'))
  if (!domainDocs.length) {
    throw createError({ statusCode: 400, message: 'no jmap:domain docs on the project yet — run the domain tickets first' })
  }

  const open = tickets.find((t) => jtIsSynthesis(t) && !jtIsFinished(t))
  if (open) return { ticketKey: open.key, created: false }

  const ticket = await jticketFetch<{ key: string }>('/api/tickets', {
    method: 'POST',
    body: {
      title: `Synthesize the ${map.title} map`,
      description: [
        `Synthesis pass for the jMap map \`${map.key}\` (project ${map.projectKey}, repo \`${map.repoPath}\`).`,
        '',
        `Read this project's ${domainDocs.length} \`jmap:domain\` walkthrough docs, unify them into the system graph (one node per domain, shared systems promoted, edges from the Dependencies sections), and POST the result to jMap at \`/api/maps/${map.key}/synthesis\`. The \`/jmap-synthesize\` skill carries the full contract.`,
      ].join('\n'),
      type: 'AFK',
      projectId: map.projectKey,
      labels: ['jmap', 'jmap:synthesize'],
      acceptanceCriteria: [
        `The graph is POSTed to jMap (map \`${map.key}\`) and the map renders at https://jmap.local/m/${map.key}`,
        'This ticket is resolved with the node/edge counts',
      ],
    },
  })
  return { ticketKey: ticket.key, created: true }
})
