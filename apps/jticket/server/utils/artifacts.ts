import { DIFF_BASE_PATH, diffRouteUrl, diffRoutes } from '@jsuite/diff/routes'
import type { Attachment, Project, ResolvedAttachment, Ticket } from '#shared/types/tracker'
import type { Store } from './store'

// The review routes as jTicket mounts them. jTicket sets no `diff.basePath` of
// its own, so it gets the layer's namespaced default — and this is the constant
// that default is written from, which is as close as server code can get to
// reading app config. Give jTicket its own `diff.basePath` and this has to be
// pointed at it too.
const review = diffRoutes(DIFF_BASE_PATH)

// Reading and writing the far end of an attachment. A ref is just {type, id};
// everything a caller wants to *show* — a title, somewhere to open it, when it
// last moved — belongs to the artifact and is read from its pool on demand.
// Nothing here is persisted, and resolving never throws: an artifact that has
// been deleted out from under a ref comes back `missing`, which is a state to
// render, not an error. That is the whole contract this file exists to hold, so
// no page or endpoint has to defend against a dangling ref itself.
//
// The /:id/attachments endpoints live here too, as handlers the six route files
// re-export. Tickets and projects differ in exactly one thing — which repo a
// diff ref is read against — and that difference belongs in one place.

// ResolvedAttachment — the shape this file builds — is declared with the rest
// of jTicket's vocabulary in shared/types/tracker.ts.
async function resolveOne(att: Attachment, repo: string): Promise<ResolvedAttachment> {
  const gone = (reason: string): ResolvedAttachment => ({
    ...att,
    title: att.id,
    url: '',
    updatedAt: '',
    missing: true,
    reason,
  })

  switch (att.type) {
    case 'document': {
      const doc = await readDoc(att.id)
      if (!doc) return gone('no document with that key in the shared pool')
      return {
        ...att,
        title: doc.title || att.id,
        url: `/documents/${att.id}`,
        updatedAt: doc.updatedAt ?? '',
        missing: false,
      }
    }
    case 'chart': {
      const chart = await readChart(att.id)
      if (!chart) return gone('no chart with that key in the shared pool')
      return {
        ...att,
        title: chart.title || att.id,
        // In-app: jTicket serves the charting layer's own workbench, so a chart
        // opens here rather than bouncing the reader over to jChart.
        url: `/charts/${att.id}`,
        updatedAt: chart.updatedAt ?? '',
        missing: false,
      }
    }
    case 'diff': {
      // A diff has no pool file to look for: it is a review target computed
      // from a repo on demand. Without a repo there is nowhere to send anyone.
      if (!repo.trim()) return gone('no repo to review this against')
      // As stored, '~' and all, rather than expanded — the review engine
      // expands it server-side, and spelling it the same way everywhere in
      // jTicket is what keeps the review UI's client-side state (keyed on this
      // string) from splitting in two.
      const repoRef = repo.trim()
      const branch = att.id.startsWith('branch/') ? att.id.slice('branch/'.length) : null
      return {
        ...att,
        title: branch ? `branch ${branch}` : `#${att.id}`,
        // In-app, like a document or a chart: jTicket extends @jsuite/diff, so
        // the review renders here rather than bouncing the reader over to jDiff.
        url: diffRouteUrl(
          branch ? review.branch({ repo: repoRef, branch }) : review.pr(repoRef, att.id),
        ),
        updatedAt: '',
        missing: false,
        repo: repoRef,
      }
    }
  }
}

/**
 * Resolve a whole attachment list, in order, tolerating anything. Callers get
 * one row per ref — including the dangling ones, which is the point: a link the
 * human made is worth showing as broken rather than silently dropping.
 */
export async function resolveAttachments(
  attachments: Attachment[],
  repo = '',
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = []
  for (const att of attachments ?? []) {
    try {
      out.push(await resolveOne(att, repo))
    } catch (err) {
      // A pool that can't be read at all (permissions, a half-written file) is
      // still just a missing artifact from a ticket's point of view.
      out.push({
        ...att,
        title: att.id,
        url: '',
        updatedAt: '',
        missing: true,
        reason: `could not be read: ${(err as Error)?.message ?? err}`,
      })
    }
  }
  return out
}

// ── The /:id/attachments endpoints ──────────────────────────────────────────
type OwnerKind = 'ticket' | 'project'

interface Attachable {
  /** The record itself — mutate `attachments` and `updatedAt`, then saveStore. */
  record: Ticket | Project
  /** The repo this record's diff refs resolve against; '' when there is none. */
  repo: string
}

/** The ticket or project a /:id/attachments route names (id or key), or a 404. */
function findAttachable(store: Store, kind: OwnerKind, ref: unknown): Attachable {
  const id = String(ref ?? '')
  if (kind === 'project') {
    const project = store.projects.find((p) => p.id === id || p.key === id)
    if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
    return { record: project, repo: project.repo }
  }
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  // A ticket's diffs are reviewed against its *project's* repo — a ticket in
  // the backlog has none, so they read as missing.
  return { record: ticket, repo: store.projects.find((p) => p.id === ticket.projectId)?.repo ?? '' }
}

/** One {type, id} out of a payload, or a 400 spelling out the shape. */
function readAttachment(payload: unknown): Attachment {
  const [attachment] = cleanAttachments([payload])
  if (!attachment) {
    throw createError({
      statusCode: 400,
      statusMessage: 'need { type: document|chart|diff, id }',
      message:
        'id is a pool key for a document or chart, and a PR number or branch/<name> for a diff',
    })
  }
  return attachment
}

/**
 * GET — the record's artifacts, resolved: one row per ref, dangling ones
 * included and flagged `missing`.
 */
export function resolveAttachmentsHandler(kind: OwnerKind) {
  return defineEventHandler(async (event) => {
    const { record, repo } = findAttachable(loadStore(), kind, getRouterParam(event, 'id'))
    return await resolveAttachments(record.attachments, repo)
  })
}

/**
 * POST — link an artifact: { type, id }. Idempotent, and the artifact needn't
 * exist yet; a ref that points at nothing simply reads as missing.
 */
export function attachHandler(kind: OwnerKind) {
  return defineEventHandler(async (event) => {
    const attachment = readAttachment(await readBody(event))
    const store = loadStore()
    const { record } = findAttachable(store, kind, getRouterParam(event, 'id'))
    record.attachments = addAttachment(record.attachments, attachment)
    record.updatedAt = now()
    saveStore(store)
    setCreated(event)
    return record.attachments
  })
}

/**
 * DELETE — unlink an artifact: ?type=&id= (a diff id contains a slash, so it
 * travels as a query param, not a route segment). The artifact itself is never
 * touched — jTicket only ever owned the link.
 */
export function detachHandler(kind: OwnerKind) {
  return defineEventHandler((event) => {
    const attachment = readAttachment(getQuery(event))
    const store = loadStore()
    const { record } = findAttachable(store, kind, getRouterParam(event, 'id'))
    record.attachments = removeAttachment(record.attachments, attachment)
    record.updatedAt = now()
    saveStore(store)
    return record.attachments
  })
}
