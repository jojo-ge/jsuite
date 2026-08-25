import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openFrame, roomKey, sealFrame } from './syncCrypto'

// The seal is what carries sync's confidentiality now that frames cross a
// third-party relay instead of a DTLS data channel. Its whole contract: only
// the room secret opens a frame, and a frame that has been touched does not
// open at all.

const secret = () => randomBytes(24).toString('base64url')

describe('roomKey', () => {
  it('is deterministic — both machines derive the same key from the link', () => {
    const s = secret()
    expect(roomKey(s).equals(roomKey(s))).toBe(true)
  })

  it('differs per room', () => {
    expect(roomKey(secret()).equals(roomKey(secret()))).toBe(false)
  })

  it('is a 256-bit key', () => {
    expect(roomKey(secret())).toHaveLength(32)
  })

  it('refuses an empty secret rather than keying off nothing', () => {
    expect(() => roomKey('')).toThrow(/required/)
  })
})

describe('sealFrame / openFrame', () => {
  it('round-trips a frame', () => {
    const key = roomKey(secret())
    const plaintext = JSON.stringify({ v: 1, kind: 'pull-request', requestId: 'r1' })
    expect(openFrame(key, sealFrame(key, plaintext))).toBe(plaintext)
  })

  it('round-trips multi-byte text — a board is full of it', () => {
    const key = roomKey(secret())
    const plaintext = 'héllo — 世界 🎟️ ' + 'x'.repeat(10_000)
    expect(openFrame(key, sealFrame(key, plaintext))).toBe(plaintext)
  })

  it('never emits the same ciphertext twice for the same plaintext', () => {
    const key = roomKey(secret())
    expect(sealFrame(key, 'same')).not.toBe(sealFrame(key, 'same'))
  })

  it('leaks no plaintext into the sealed form', () => {
    const key = roomKey(secret())
    const sealed = sealFrame(key, 'SECRET_TICKET_BODY')
    expect(sealed).not.toContain('SECRET_TICKET_BODY')
    expect(Buffer.from(sealed, 'base64').toString('utf8')).not.toContain('SECRET_TICKET_BODY')
  })

  it("returns null for another room's frame", () => {
    const sealed = sealFrame(roomKey(secret()), 'not for you')
    expect(openFrame(roomKey(secret()), sealed)).toBeNull()
  })

  it('returns null for a tampered frame — the auth tag is what forbids forgery', () => {
    const key = roomKey(secret())
    const raw = Buffer.from(sealFrame(key, 'the original message'), 'base64')
    raw[raw.length - 1] ^= 0xff // flip a bit of ciphertext
    expect(openFrame(key, raw.toString('base64'))).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['not base64', '!!!! not base64 !!!!'],
    ['too short to hold a nonce and tag', Buffer.alloc(8).toString('base64')],
    ['plausible length, pure noise', randomBytes(64).toString('base64')],
  ])('returns null for garbage (%s) rather than throwing', (_name, sealed) => {
    expect(openFrame(roomKey(secret()), sealed)).toBeNull()
  })
})
