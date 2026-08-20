// jMap's line to jTicket — the tracker carries ALL the mapping work (a
// jmap-mode project, its scoping/domain tickets, the docs they produce), and
// jMap talks to it server-side over its HTTP API so the browser never has to
// cross origins.

const JTICKET_BASE = process.env.JTICKET_URL || 'http://localhost:43000'
export const JTICKET_PUBLIC = 'https://jticket.local'

export async function jticketFetch<T = any>(path: string, opts: any = {}): Promise<T> {
  try {
    return await $fetch<T>(`${JTICKET_BASE}${path}`, { timeout: 5_000, ...opts })
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        message: `jTicket said ${status}: ${String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? '').slice(0, 300)}`,
      })
    }
    throw createError({
      statusCode: 503,
      message: 'jTicket is not reachable on :43000 — run ./jsuite status, then ./jsuite start',
    })
  }
}

export interface JtTicket {
  id: string
  key: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done' | 'merged'
  assignee: string
  labels: string[]
  resolution: string
}

export interface JtDoc {
  id: string
  key: string
  title: string
  documentKey: string
  labels: string[]
  status: string
}

export const jtIsFinished = (t: JtTicket) => t.status === 'done' || t.status === 'merged'
export const jtIsScoping = (t: JtTicket) => t.labels.includes('jmap:scope')
export const jtIsSynthesis = (t: JtTicket) => t.labels.includes('jmap:synthesize')

/** The project's live state in one round trip pair: tickets + docs. */
export async function fetchJmapProject(projectKey: string): Promise<{
  project: { key: string; title: string } | null
  tickets: JtTicket[]
  docs: JtDoc[]
}> {
  const [project, docs] = await Promise.all([
    jticketFetch<{ key: string; title: string; tickets: JtTicket[] }>(`/api/projects/${projectKey}`),
    jticketFetch<JtDoc[]>(`/api/docs?projectId=${encodeURIComponent(projectKey)}`),
  ])
  return {
    project: { key: project.key, title: project.title },
    tickets: project.tickets ?? [],
    docs,
  }
}
