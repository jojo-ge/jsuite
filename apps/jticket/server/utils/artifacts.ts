import type { Attachment, Project, Store, Ticket } from './store'

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

// jChart's own reader, for charts jTicket has no page of its own for yet.
// Matches the JDIFF_URL convention in utils/github.ts.
const CHART_BASE = (process.env.JCHART_URL ?? 'https://jchart.local').replace(/\/+$/, '')

export interface ResolvedAttachment extends Attachment {
  /** The artifact's own title, or a readable stand-in when there's nothing to read. */
  title: string
  /** Where to open it — in-app for documents, the owning app otherwise. '' if missing. */
  url: string
  /** The artifact's last write, when the pool records one. '' for a diff, which has no file. */
  updatedAt: string
  /**
   * True when there is nothing to open. Two different situations land here, and
   * `reason` is what tells them apart:
   *   - the artifact is gone — deleted out from under the ref, or never created
   *   - a diff ref has no repo to be read against (its project has none, or the
   *     ticket is in the backlog and so has no project at all)
   * Note a diff's target is *not* verified: jDiff resolves a PR number or branch
   * lazily against git and gh, which is far too expensive to do per ref on a
   * page load. `missing: false` on a diff therefore means "we know where to send
   * you", not "the branch still exists".
   */
  missing: boolean
  /** Why it's missing, for a UI that wants to say more than "missing". */
  reason?: string
}

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
        url: `/docs/${att.id}`,
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
        url: `${CHART_BASE}/c/${att.id}`,
        updatedAt: chart.updatedAt ?? '',
        missing: false,
      }
    }
    case 'diff': {
      // A diff has no pool file to look for: it is a review target jDiff
      // computes from a repo. Without a repo there is nowhere to send anyone.
      if (!repo.trim()) return gone('no repo to review this against')
      const path = expandHome(repo.trim())
      const branch = att.id.startsWith('branch/') ? att.id.slice('branch/'.length) : null
      return {
        ...att,
        title: branch ? `branch ${branch}` : `#${att.id}`,
        url: branch ? jdiffBranchUrl(path, branch) : jdiffPrUrl(path, att.id),
        updatedAt: '',
        missing: false,
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
    setResponseStatus(event, 201)
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
