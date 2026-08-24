import { describe, expect, it } from 'vitest'
import {
  assertServable,
  createOrRearmShare,
  findShare,
  importedShareError,
  isValidSharedKey,
  recordImportedShare,
  revokeShare,
  parseShareBlob,
  shareLink,
  shareStatus,
  type Share,
} from './shares'
import { sharedTicketKey } from './ownership'

const AT = '2026-08-24T12:00:00.000Z'
const TWO_HOURS_LATER = '2026-08-24T14:00:00.000Z'

function state(): { shares: Share[] } {
  return { shares: [] }
}

describe('creating a share', () => {
  it('mints a share record with a stable UUID, a room, and a 2-hour expiry', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)

    expect(s.shares).toEqual([share])
    expect(share.projectId).toBe('proj_abc123')
    expect(share.sharedKey).toBe('CART')
    expect(share.projectUuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(share.roomId).not.toBe('')
    expect(share.roomSecret).not.toBe('')
    expect(share.roomId).not.toBe(share.roomSecret)
    expect(share.side).toBe('creator')
    expect(share.expiresAt).toBe(TWO_HOURS_LATER)
    expect(share.revokedAt).toBeNull()
  })

  it('returns a link whose fragment carries the full capability blob', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)

    const link = shareLink(share, 'http://localhost:43000')
    expect(link.startsWith('http://localhost:43000/import#')).toBe(true)

    const fragment = link.split('#')[1]!
    const blob = parseShareBlob(fragment, AT)
    expect(blob).toEqual({
      v: 1,
      projectUuid: share.projectUuid,
      sharedKey: 'CART',
      roomId: share.roomId,
      roomSecret: share.roomSecret,
      // The recipient of a creator's link plays the importer side (even keys).
      side: 'importer',
      expiresAt: TWO_HOURS_LATER,
    })
  })
})

describe('expiry', () => {
  it('serves right up to the 2-hour mark', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    expect(assertServable(share, '2026-08-24T13:59:59.999Z')).toBe(share)
  })

  it('refuses to serve a share older than 2 hours', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    expect(() => assertServable(share, TWO_HOURS_LATER)).toThrowError(/expired/)
  })

  it('refuses to serve a missing share', () => {
    expect(() => assertServable(undefined, AT)).toThrowError(/not shared/)
  })

  it('rejects an expired link on import', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    const fragment = shareLink(share, 'http://localhost:43000').split('#')[1]!
    expect(parseShareBlob(fragment, '2026-08-24T13:59:59.999Z')).toBeTruthy()
    expect(() => parseShareBlob(fragment, TWO_HOURS_LATER)).toThrowError(/expired/)
  })

  it('rejects garbage on import', () => {
    expect(() => parseShareBlob('not-a-blob', AT)).toThrowError(/not a share link/)
  })

  it('rejects a forged blob whose shared key breaks the 1–4 char rule', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    const fragment = shareLink(share, 'http://localhost:43000').split('#')[1]!
    const blob = JSON.parse(Buffer.from(fragment, 'base64url').toString('utf8'))
    const forged = Buffer.from(
      JSON.stringify({ ...blob, sharedKey: 'X'.repeat(40) }),
      'utf8',
    ).toString('base64url')
    expect(() => parseShareBlob(forged, AT)).toThrowError(/not a share link/)
  })
})

describe('stop-sharing and re-sharing', () => {
  it('revokes immediately — a fresh, unexpired share refuses to serve once stopped', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    const revoked = revokeShare(s, 'proj_abc123', '2026-08-24T12:01:00.000Z')
    expect(revoked).toBe(share)
    expect(share.revokedAt).toBe('2026-08-24T12:01:00.000Z')
    expect(() => assertServable(share, '2026-08-24T12:01:00.000Z')).toThrowError(/revoked/)
  })

  it('re-sharing re-arms the same share: same UUID, fresh room and expiry, revocation cleared', () => {
    const s = state()
    const first = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    const { id, projectUuid, roomId, roomSecret } = first
    revokeShare(s, 'proj_abc123', '2026-08-24T12:01:00.000Z')

    const again = createOrRearmShare(s, 'proj_abc123', 'CART', '2026-08-24T15:00:00.000Z')
    expect(s.shares).toHaveLength(1)
    expect(again.id).toBe(id)
    expect(again.projectUuid).toBe(projectUuid)
    expect(again.roomId).not.toBe(roomId)
    expect(again.roomSecret).not.toBe(roomSecret)
    expect(again.expiresAt).toBe('2026-08-24T17:00:00.000Z')
    expect(again.revokedAt).toBeNull()
    expect(assertServable(again, '2026-08-24T15:00:00.000Z')).toBe(again)
  })

  it("refuses to re-arm an imported share — the room is the creator's to rotate", () => {
    const creator = state()
    const share = createOrRearmShare(creator, 'proj_creator', 'CART', AT)
    const blob = parseShareBlob(shareLink(share, 'http://localhost:43000').split('#')[1]!, AT)

    const importer = state()
    recordImportedShare(importer, blob, 'proj_importer', AT)
    expect(() => createOrRearmShare(importer, 'proj_importer', 'CART', AT)).toThrowError(/creator/)
  })
})

describe('shared key clashes (creator side)', () => {
  it("rejects this machine's own key prefixes", () => {
    for (const k of ['TICK', 'PROJ', 'DOC', 'PR']) {
      expect(() => createOrRearmShare(state(), 'proj_abc123', k, AT)).toThrowError(/in use/)
    }
  })

  it("rejects a key another project's share already uses", () => {
    const s = state()
    createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    expect(() => createOrRearmShare(s, 'proj_other', 'CART', AT)).toThrowError(/in use/)
    expect(s.shares).toHaveLength(1)
  })

  it('re-arming the same project with its own key is not a clash', () => {
    const s = state()
    createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    expect(createOrRearmShare(s, 'proj_abc123', 'CART', '2026-08-24T13:00:00.000Z').sharedKey).toBe('CART')
  })

  it('the key is fixed for the share\'s lifetime — re-arming cannot change it', () => {
    const s = state()
    createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    expect(() => createOrRearmShare(s, 'proj_abc123', 'SHOP', '2026-08-24T13:00:00.000Z')).toThrowError(/fixed/)
    expect(findShare(s, 'proj_abc123')!.sharedKey).toBe('CART')
  })
})

describe('share status', () => {
  it('walks active → revoked → active → expired through the lifecycle', () => {
    const s = state()
    const share = createOrRearmShare(s, 'proj_abc123', 'CART', AT)
    expect(shareStatus(share, AT)).toBe('active')
    revokeShare(s, 'proj_abc123', '2026-08-24T12:01:00.000Z')
    expect(shareStatus(share, '2026-08-24T12:01:00.000Z')).toBe('revoked')
    createOrRearmShare(s, 'proj_abc123', 'CART', '2026-08-24T15:00:00.000Z')
    expect(shareStatus(share, '2026-08-24T15:00:00.000Z')).toBe('active')
    expect(shareStatus(share, '2026-08-24T17:00:00.000Z')).toBe('expired')
  })
})

describe('importing a share link (peer side)', () => {
  // A creator machine's share, as the importing machine receives it: the
  // decoded blob from the link's fragment.
  function received(key = 'CART') {
    const creator = state()
    const share = createOrRearmShare(creator, 'proj_on_creator', key, AT)
    const fragment = shareLink(share, 'http://localhost:43000').split('#')[1]!
    return { creator, share, blob: parseShareBlob(fragment, AT) }
  }

  it('persists an importer-side record from the blob, keyed by the shared project UUID', () => {
    const { share, blob } = received()
    const s = state()
    const imported = recordImportedShare(s, blob, 'proj_on_importer', AT)

    expect(s.shares).toEqual([imported])
    expect(imported.projectId).toBe('proj_on_importer')
    expect(imported.projectUuid).toBe(share.projectUuid)
    expect(imported.sharedKey).toBe('CART')
    expect(imported.roomId).toBe(share.roomId)
    expect(imported.roomSecret).toBe(share.roomSecret)
    expect(imported.side).toBe('importer')
    expect(imported.expiresAt).toBe(share.expiresAt)
    expect(imported.revokedAt).toBeNull()
  })

  it('re-importing a re-armed link updates the record in place — same project, fresh room', () => {
    const { creator, blob } = received()
    const s = state()
    const first = recordImportedShare(s, blob, 'proj_on_importer', AT)

    const rearmed = createOrRearmShare(creator, 'proj_on_creator', 'CART', '2026-08-24T15:00:00.000Z')
    const fragment = shareLink(rearmed, 'http://localhost:43000').split('#')[1]!
    const again = recordImportedShare(
      s,
      parseShareBlob(fragment, '2026-08-24T15:00:00.000Z'),
      'proj_on_importer',
      '2026-08-24T15:00:00.000Z',
    )

    expect(s.shares).toHaveLength(1)
    expect(again.id).toBe(first.id)
    expect(again.projectId).toBe('proj_on_importer')
    expect(again.roomId).toBe(rearmed.roomId)
    expect(again.roomSecret).toBe(rearmed.roomSecret)
    expect(again.expiresAt).toBe('2026-08-24T17:00:00.000Z')
    expect(again.revokedAt).toBeNull()
  })

  it('projectId is authoritative — a record whose local project died adopts the fresh one', () => {
    const { blob } = received()
    const s = state()
    const first = recordImportedShare(s, blob, 'proj_deleted_later', AT)
    const again = recordImportedShare(s, blob, 'proj_recreated', '2026-08-24T13:00:00.000Z')
    expect(again.id).toBe(first.id)
    expect(again.projectId).toBe('proj_recreated')
  })

  it("rejects a key that clashes with this machine's own key prefixes — the pair renegotiates", () => {
    const { blob } = received()
    const forged = { ...blob, sharedKey: 'TICK' }
    expect(importedShareError(state(), forged)).toMatch(/renegotiate/)
  })

  it("rejects a key another share on this machine already uses", () => {
    const { blob } = received()
    const s = state()
    createOrRearmShare(s, 'proj_local', 'CART', AT)
    expect(importedShareError(s, blob)).toMatch(/renegotiate/)
    expect(() => recordImportedShare(s, blob, 'proj_on_importer', AT)).toThrowError(/renegotiate/)
    expect(s.shares).toHaveLength(1)
  })

  it('re-importing the same shared project is not a clash', () => {
    const { blob } = received()
    const s = state()
    recordImportedShare(s, blob, 'proj_on_importer', AT)
    expect(importedShareError(s, blob)).toBeNull()
  })

  it("rejects this machine's own link — the link is for the coworker", () => {
    const { creator, blob } = received()
    expect(importedShareError(creator, blob)).toMatch(/own/)
    expect(() => recordImportedShare(creator, blob, 'proj_again', AT)).toThrowError(/own/)
  })

  it('the blob arms the importing side to mint even ticket numbers', () => {
    const { blob } = received()
    const share = { key: blob.sharedKey, side: blob.side, peerName: 'ana' }
    expect(sharedTicketKey(share, [])).toBe('CART-2')
    expect(sharedTicketKey(share, [{ key: 'CART-2' }, { key: 'CART-3' }])).toBe('CART-4')
  })
})

describe('shared key', () => {
  it('accepts 1–4 uppercase alphanumerics starting with a letter', () => {
    for (const k of ['C', 'AB', 'A1', 'CART']) expect(isValidSharedKey(k)).toBe(true)
  })

  it('rejects everything else', () => {
    for (const k of ['', 'CARTS', 'cart', '1ART', 'CA T', 'CA-T', 42, null, undefined]) {
      expect(isValidSharedKey(k)).toBe(false)
    }
  })
})
