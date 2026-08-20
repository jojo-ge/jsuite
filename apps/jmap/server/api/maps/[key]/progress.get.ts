import type { MapProgress } from '../../../../app/utils/mapTypes'

/**
 * The map's live progress, proxied from jTicket (the browser never crosses
 * origins). jTicket being down is a state, not an error — the page shows it.
 */
export default defineEventHandler(async (event): Promise<MapProgress> => {
  const key = String(getRouterParam(event, 'key'))
  const map = await readMap(key)
  if (!map) throw createError({ statusCode: 404, message: `No such map: ${key}` })

  try {
    const { project, tickets, docs } = await fetchJmapProject(map.projectKey)
    const domainDocs = docs.filter((d) => d.labels.includes('jmap:domain'))
    return {
      project: project
        ? { key: project.key, title: project.title, url: `${JTICKET_PUBLIC}/projects/${project.key}` }
        : null,
      jticketUp: true,
      tickets: tickets.map((t) => ({
        key: t.key,
        title: t.title,
        status: t.status,
        assignee: t.assignee,
        labels: t.labels,
        scoping: jtIsScoping(t),
        synthesis: jtIsSynthesis(t),
        resolution: t.resolution,
      })),
      docs: docs.map((d) => ({ key: d.key, title: d.title, documentKey: d.documentKey, labels: d.labels })),
      synthesizable: domainDocs.length > 0,
      // "Fully documented" is about the mapping work — synthesis tickets are
      // the consumers of that work, not part of it.
      allDone:
        tickets.some((t) => !jtIsSynthesis(t)) && tickets.filter((t) => !jtIsSynthesis(t)).every(jtIsFinished),
    }
  } catch (err: any) {
    if (err?.statusCode === 503) {
      return { project: null, jticketUp: false, tickets: [], docs: [], synthesizable: false, allDone: false }
    }
    throw err
  }
})
