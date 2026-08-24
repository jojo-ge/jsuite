import { describe, expect, it } from 'vitest'
import {
  assertServable,
  createOrRearmShare,
  findShare,
  isValidSharedKey,
  revokeShare,
  parseShareBlob,
  shareLink,
  shareStatus,
  type Share,
} from './shares'

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
