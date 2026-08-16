import type { Attachment, AttachmentType } from './store'

// Reading the far end of an attachment. A ref is just {type, id}; everything a
// caller wants to *show* — a title, somewhere to open it, when it last moved —
// belongs to the artifact and is read from its pool on demand. Nothing here is
// persisted, and nothing here throws: an artifact that has been deleted out
// from under a ref comes back `missing`, which is a state to render, not an
// error. That is the whole contract this file exists to hold, so no page or
// endpoint has to defend against a dangling ref itself.

// jChart's own reader, for charts jTicket has no page of its own for yet.
// Matches the JDIFF_URL convention in utils/github.ts.
const CHART_BASE = (process.env.JCHART_URL ?? 'https://jchart.local').replace(/\/+$/, '')

export interface ResolvedAttachment extends Attachment {
  /** The artifact's own title, or a readable stand-in when it's missing. */
  title: string
  /** Where to open it — in-app for documents, the owning app otherwise. '' if missing. */
  url: string
  /** The artifact's last write, when the pool records one. */
  updatedAt: string
  /** True when nothing is there to read: deleted, never created, or unreachable. */
  missing: boolean
  /** Why it's missing, for a UI that wants to say more than "missing". */
  reason?: string
}

export const ATTACHMENT_LABEL: Record<AttachmentType, string> = {
  document: 'Document',
  chart: 'Chart',
  diff: 'Diff',
}

/** Context an attachment resolves against — a diff ref is only readable against a repo. */
export interface ResolveContext {
  /** The owning project's local clone path, as stored ('~' not yet expanded). */
  repo?: string
}

async function resolveOne(att: Attachment, ctx: ResolveContext): Promise<ResolvedAttachment> {
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
      // A diff has no pool file to look for: it is a review target that jDiff
      // computes from a repo. Without a repo there is nothing to point at, so
      // that — not a deleted file — is what "missing" means for a diff.
      const repo = ctx.repo?.trim()
      if (!repo) return gone('the owning project has no repo to review this against')
      const path = expandHome(repo)
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
 * one row per ref — including the dangling ones, which is the point: a link
 * the human made is worth showing as broken rather than silently dropping.
 */
export async function resolveAttachments(
  attachments: Attachment[],
  ctx: ResolveContext = {},
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = []
  for (const att of attachments ?? []) {
    try {
      out.push(await resolveOne(att, ctx))
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
