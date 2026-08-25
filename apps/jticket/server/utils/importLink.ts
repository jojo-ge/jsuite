import { createError } from 'h3'
import type { ShareBlob, ShareState } from './shares'
import { findShareByUuid, importedShareError, parseShareBlob } from './shares'
import { ShareLinkExpiredError } from './shares'

// The shared first half of the import screen's two endpoints (validate and
// confirm): decode a pasted link fragment and hold it against local state,
// mapped to HTTP — 400 malformed, 410 expired, 409 key clash or own link.
// Fragments travel in POST bodies only, never in URLs, so the room secret
// stays out of request logs.
export function readImportFragment(state: ShareState, fragment: unknown, at?: string): ShareBlob {
  if (typeof fragment !== 'string' || !fragment.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'fragment is required' })
  }
  let blob: ShareBlob
  try {
    blob = parseShareBlob(fragment.trim(), at)
  } catch (e) {
    throw createError({
      statusCode: e instanceof ShareLinkExpiredError ? 410 : 400,
      statusMessage: e instanceof Error ? e.message : String(e),
    })
  }
  const error = importedShareError(state, blob)
  if (error) throw createError({ statusCode: 409, statusMessage: error })
  return blob
}

// The local project a blob's share already serves — set when this link is a
// re-arm of a share this machine holds (and that project still exists).
export function importedProjectOf<P extends { id: string }>(
  state: ShareState & { projects: P[] },
  blob: ShareBlob,
): P | undefined {
  const existing = findShareByUuid(state, blob.projectUuid)
  return existing ? state.projects.find((p) => p.id === existing.projectId) : undefined
}

// What the validate endpoint answers and the import screen renders — kept as
// one type so the page and the endpoint can't drift apart.
export interface ImportPreviewDto {
  sharedKey: string
  side: ShareBlob['side']
  expiresAt: string
  existingProjectId: string | null
  peerName: string | null
}

export function importPreview(
  state: ShareState & { projects: Array<{ id: string; share: { peerName: string } | null }> },
  blob: ShareBlob,
): ImportPreviewDto {
  const project = importedProjectOf(state, blob)
  return {
    sharedKey: blob.sharedKey,
    side: blob.side,
    expiresAt: blob.expiresAt,
    existingProjectId: project?.id ?? null,
    peerName: project?.share?.peerName ?? null,
  }
}
