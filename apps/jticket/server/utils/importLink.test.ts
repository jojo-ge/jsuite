import { describe, expect, it } from 'vitest'
import { importPreview, readImportFragment } from './importLink'
import { createOrRearmShare, shareLink, type Share } from './shares'

// The import endpoints' shared HTTP mapping: what the screen's one honest
// error actually is per failure — 400 malformed, 410 expired (AC: "an expired
// link is rejected with a clear message"), 409 clash or own link.

const AT = '2026-08-24T12:00:00.000Z'
const TWO_HOURS_LATER = '2026-08-24T14:00:00.000Z'

function fragmentFor(key = 'CART') {
  const creator: { shares: Share[] } = { shares: [] }
  const share = createOrRearmShare(creator, 'proj_on_creator', key, AT)
  return { creator, share, fragment: shareLink(share, 'http://localhost:43000').split('#')[1]! }
}

function statusOf(fn: () => unknown): number {
  try {
    fn()
  } catch (e) {
    return (e as { statusCode: number }).statusCode
  }
  throw new Error('expected readImportFragment to throw')
}

describe('readImportFragment', () => {
  it('accepts a live link', () => {
    const { fragment } = fragmentFor()
    expect(readImportFragment({ shares: [] }, fragment, AT).sharedKey).toBe('CART')
  })

  it('maps an expired link to 410 with the clear message', () => {
    const { fragment } = fragmentFor()
    expect(statusOf(() => readImportFragment({ shares: [] }, fragment, TWO_HOURS_LATER))).toBe(410)
    try {
      readImportFragment({ shares: [] }, fragment, TWO_HOURS_LATER)
    } catch (e) {
      expect((e as { statusMessage: string }).statusMessage).toMatch(/expired/)
    }
  })

  it('maps garbage and missing fragments to 400', () => {
    expect(statusOf(() => readImportFragment({ shares: [] }, 'not-a-blob', AT))).toBe(400)
    expect(statusOf(() => readImportFragment({ shares: [] }, undefined, AT))).toBe(400)
  })

  it('maps a shared-key clash and an own link to 409', () => {
    const { creator, fragment } = fragmentFor()
    const clashing: { shares: Share[] } = { shares: [] }
    createOrRearmShare(clashing, 'proj_local', 'CART', AT)
    expect(statusOf(() => readImportFragment(clashing, fragment, AT))).toBe(409)
    expect(statusOf(() => readImportFragment(creator, fragment, AT))).toBe(409)
  })
})

describe('importPreview', () => {
  it('names the already-imported project on a re-armed link, null on a first import', () => {
    const { fragment, share } = fragmentFor()
    const blob = readImportFragment({ shares: [] }, fragment, AT)

    const fresh = { shares: [], projects: [] }
    expect(importPreview(fresh, blob)).toEqual({
      sharedKey: 'CART',
      side: 'importer',
      expiresAt: share.expiresAt,
      existingProjectId: null,
      peerName: null,
    })

    const imported = {
      shares: [{ ...share, id: 'share_b', projectId: 'proj_b', side: 'importer' as const }],
      projects: [{ id: 'proj_b', share: { peerName: 'Ana' } }],
    }
    const preview = importPreview(imported, blob)
    expect(preview.existingProjectId).toBe('proj_b')
    expect(preview.peerName).toBe('Ana')
  })
})
