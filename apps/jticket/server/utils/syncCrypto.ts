import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

// End-to-end encryption for sync frames (TICK-3xx, spec DOC-30).
//
// WebRTC used to give the pull flow its confidentiality for free: DTLS between
// the two machines, and the relay ferried nothing but handshake blobs. Sync now
// rides a broadcast channel on a third-party realtime service, so the frames
// themselves must carry that guarantee — the service sees ciphertext and
// nothing else, exactly as the worker saw only opaque blobs before.
//
// The key is the share's own roomSecret (24 random bytes, minted locally and
// carried only in the link's fragment), stretched with HKDF. No new secret and
// no change to the share link: whoever holds the link can read the room, which
// is the same capability boundary the room secret already drew.

const KEY_BYTES = 32 // AES-256
const IV_BYTES = 12 // GCM standard nonce
const TAG_BYTES = 16
const INFO = 'jticket-sync-v1'

/** Derive a room's frame key from its secret. Pure — same secret, same key. */
export function roomKey(roomSecret: string): Buffer {
  if (!roomSecret) throw new Error('roomSecret is required')
  // The room id is public and the secret is high-entropy already, so a fixed
  // empty salt is fine: HKDF is stretching, not slowing down a guesser.
  return Buffer.from(hkdfSync('sha256', Buffer.from(roomSecret, 'utf8'), Buffer.alloc(0), INFO, KEY_BYTES))
}

/**
 * Seal one frame. The output is base64 of iv ‖ tag ‖ ciphertext — one opaque
 * string, which is all the transport ever handles.
 */
export function sealFrame(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

/**
 * Open a sealed frame; null for anything this key did not seal — a forged or
 * tampered frame, a frame from a different room, or plain garbage. Callers
 * drop nulls silently: on a public broadcast topic, unreadable traffic is
 * noise, not an error.
 */
export function openFrame(key: Buffer, sealed: string): string | null {
  let raw: Buffer
  try {
    raw = Buffer.from(sealed, 'base64')
  } catch {
    return null
  }
  if (raw.length < IV_BYTES + TAG_BYTES) return null
  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null // auth tag mismatch — not ours
  }
}

/** Constant-time equality for two room keys (used by the loopback transport). */
export function sameKey(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}
