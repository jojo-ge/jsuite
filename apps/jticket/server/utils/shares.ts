import { randomBytes, randomUUID } from 'node:crypto'
import { newId, now } from './store'

// ── Share model ─────────────────────────────────────────────────────────────
// A share exposes one project to exactly one peer (jTicket sync, DOC-30). The
// record lives in jTicket state on the machine that created it; the peer gets
// a capability link whose *fragment* carries the blob — fragments never reach
// server logs, so the room secret stays between the two humans.

// Which parity of ticket numbers this machine mints for the shared project:
// the link creator mints odd numbers, the importer even.
export type ShareSide = 'creator' | 'importer'

export interface Share {
  id: string
  projectId: string // local project this share exposes
  // Stable cross-machine identity of the shared project. Minted on first
  // share and kept through every re-arm and revoke — both peers key the
  // shared project by this, never by their local ids.
  projectUuid: string
  sharedKey: string // 1–4 char key the shared project uses on both machines
  roomId: string // signaling-relay room …
  roomSecret: string // … and the secret that opens it
  side: ShareSide // parity THIS machine holds for the shared project
  expiresAt: string // links are valid 2 hours; re-sharing re-arms
  revokedAt: string | null // stop-sharing stamps this; re-sharing clears it
  createdAt: string
  updatedAt: string
}

// Anything holding a shares array — the real Store qualifies structurally.
export interface ShareState {
  shares: Share[]
}

export const SHARE_TTL_MS = 2 * 60 * 60 * 1000

// The shared project's key on both machines: 1–4 chars, TICK-shaped — a
// letter, then letters/digits. Chosen at share time; the import screen
// rejects a clash with the peer's local keys so the pair renegotiates.
export function isValidSharedKey(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z][A-Z0-9]{0,3}$/.test(v)
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function findShare(state: ShareState, projectId: string): Share | undefined {
  return state.shares.find((s) => s.projectId === projectId)
}

// Prefixes this machine's own entity keys already use — a shared key equal to
// one of these would collide with local TICK-n / PROJ-n / DOC-n / PR-n keys.
const RESERVED_KEYS = new Set(['TICK', 'PROJ', 'DOC', 'PR'])

/**
 * Create a project's share, or re-arm the existing one. A project has at most
 * one share record for its lifetime: the first call mints the projectUuid, and
 * every later call keeps it while rotating the room, the secret, and the
 * expiry — so a re-shared link dials a fresh room but lands on the same shared
 * project, and a revoked share comes back to life instead of duplicating.
 */
export function createOrRearmShare(
  state: ShareState,
  projectId: string,
  sharedKey: string,
  at: string = now(),
): Share {
  // "Must be free on both machines" (DOC-30) — this is the creator's half;
  // the peer's half is the import screen's clash check.
  if (RESERVED_KEYS.has(sharedKey) || state.shares.some((s) => s.projectId !== projectId && s.sharedKey === sharedKey)) {
    throw new Error(`shared key already in use on this machine: ${sharedKey}`)
  }
  const existing = findShare(state, projectId)
  if (existing) {
    // Re-arm never renames: the key is the shared project's identity on both
    // machines, fixed when the share is first cut (DOC-30 lists only the room
    // and expiry as rotating).
    if (existing.sharedKey !== sharedKey) {
      throw new Error(`shared key is fixed for the share's lifetime: ${existing.sharedKey}`)
    }
    existing.roomId = newRoomId()
    existing.roomSecret = newRoomSecret()
    existing.expiresAt = expiryFrom(at)
    existing.revokedAt = null
    existing.updatedAt = at
    return existing
  }
  const share: Share = {
    id: newId('share'),
    projectId,
    projectUuid: randomUUID(),
    sharedKey,
    roomId: newRoomId(),
    roomSecret: newRoomSecret(),
    side: 'creator',
    expiresAt: expiryFrom(at),
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  state.shares.push(share)
  return share
}

/**
 * Stop sharing a project. The record stays (it anchors the projectUuid for a
 * later re-share) but serving refuses from this instant — revocation doesn't
 * wait for the expiry clock.
 */
export function revokeShare(state: ShareState, projectId: string, at: string = now()): Share | undefined {
  const share = findShare(state, projectId)
  if (!share || share.revokedAt) return share
  share.revokedAt = at
  share.updatedAt = at
  return share
}

export function shareIsExpired(share: Pick<Share, 'expiresAt'>, at: string = now()): boolean {
  return Date.parse(at) >= Date.parse(share.expiresAt)
}

/**
 * The serving-side gate: every path that would answer for a project's share —
 * opening the room, exporting a snapshot — asks this first. Refuses unless the
 * share exists and reads active. (In-flight pulls complete; this guards the
 * *start* of serving.)
 */
export function assertServable(share: Share | undefined, at: string = now()): Share {
  if (!share) throw new Error('project is not shared')
  const status = shareStatus(share, at)
  if (status !== 'active') throw new Error(`share ${status}`)
  return share
}

// What the share UI renders and the serving gate refuses on: revocation trumps
// the clock (a revoked share reads 'revoked' even past its expiry).
export type ShareStatus = 'active' | 'revoked' | 'expired'

export function shareStatus(share: Share, at: string = now()): ShareStatus {
  if (share.revokedAt) return 'revoked'
  if (shareIsExpired(share, at)) return 'expired'
  return 'active'
}

function expiryFrom(at: string): string {
  return new Date(Date.parse(at) + SHARE_TTL_MS).toISOString()
}

function newRoomId(): string {
  return randomBytes(12).toString('base64url')
}

function newRoomSecret(): string {
  return randomBytes(24).toString('base64url')
}

// What the share endpoints return: the record plus its derived status, and —
// only while active — the capability link to hand to the peer. The share UI
// imports this type, so the panel and the endpoints can't drift apart.
export interface ShareViewDto extends Share {
  status: ShareStatus
  link: string | null
}

export function shareView(share: Share, base: string, at: string = now()): ShareViewDto {
  const status = shareStatus(share, at)
  return { ...share, status, link: status === 'active' ? shareLink(share, base) : null }
}

// ── Capability link ─────────────────────────────────────────────────────────
// The blob a link's fragment carries: everything the peer's import screen
// needs to create the shared project and dial the room. The side it names is
// the RECIPIENT's — the opposite of the record's.

export interface ShareBlob {
  v: 1
  projectUuid: string
  sharedKey: string
  roomId: string
  roomSecret: string
  side: ShareSide
  expiresAt: string
}

export function shareLink(share: Share, base: string): string {
  const blob: ShareBlob = {
    v: 1,
    projectUuid: share.projectUuid,
    sharedKey: share.sharedKey,
    roomId: share.roomId,
    roomSecret: share.roomSecret,
    side: share.side === 'creator' ? 'importer' : 'creator',
    expiresAt: share.expiresAt,
  }
  const fragment = Buffer.from(JSON.stringify(blob), 'utf8').toString('base64url')
  return `${base.replace(/\/$/, '')}/import#${fragment}`
}

// ── Importing (the peer side of the link) ───────────────────────────────────

export function findShareByUuid(state: ShareState, projectUuid: string): Share | undefined {
  return state.shares.find((s) => s.projectUuid === projectUuid)
}

/**
 * Why a parsed blob can't be imported on this machine — null when it can.
 * Two refusals: the link is this machine's own (the record for that UUID holds
 * the opposite side), or the shared key collides with local keys — the peer's
 * half of DOC-30's "free on both machines"; the pair renegotiates the key and
 * re-shares. A record already holding the blob's side is a re-import, never a
 * clash.
 */
export function importedShareError(state: ShareState, blob: ShareBlob): string | null {
  const existing = findShareByUuid(state, blob.projectUuid)
  if (existing) {
    return existing.side === blob.side
      ? null
      : 'this is your own share link — paste it to your coworker instead'
  }
  if (RESERVED_KEYS.has(blob.sharedKey) || state.shares.some((s) => s.sharedKey === blob.sharedKey)) {
    return `shared key ${blob.sharedKey} is already in use on this machine — renegotiate the key and re-share`
  }
  return null
}

/**
 * Persist a share from an imported link blob — the importer-side twin of
 * createOrRearmShare, keyed by the shared project's UUID. A re-imported
 * (re-armed) link updates the existing record's room and expiry in place.
 * projectId is authoritative on every call: the local project this record
 * serves — pass the record's own project on a plain re-arm, a fresh one when
 * the old local project is gone.
 */
export function recordImportedShare(
  state: ShareState,
  blob: ShareBlob,
  projectId: string,
  at: string = now(),
): Share {
  const error = importedShareError(state, blob)
  if (error) throw new Error(error)
  const existing = findShareByUuid(state, blob.projectUuid)
  if (existing) {
    existing.projectId = projectId
    existing.roomId = blob.roomId
    existing.roomSecret = blob.roomSecret
    existing.expiresAt = blob.expiresAt
    existing.revokedAt = null
    existing.updatedAt = at
    return existing
  }
  const share: Share = {
    id: newId('share'),
    projectId,
    projectUuid: blob.projectUuid,
    sharedKey: blob.sharedKey,
    roomId: blob.roomId,
    roomSecret: blob.roomSecret,
    side: blob.side,
    expiresAt: blob.expiresAt,
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  state.shares.push(share)
  return share
}

// An expired link is its own refusal — the import screen maps it to 410 while
// everything malformed stays a 400 — so it gets a type instead of leaving
// callers to sniff the message.
export class ShareLinkExpiredError extends Error {}

/**
 * Decode and validate a link fragment. Throws on anything unusable —
 * malformed base64/JSON, missing fields, wrong version — so the import
 * screen can show one honest error instead of half-importing.
 */
export function parseShareBlob(fragment: string, at: string = now()): ShareBlob {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(fragment, 'base64url').toString('utf8'))
  } catch {
    throw new Error('not a share link')
  }
  const b = parsed as Partial<ShareBlob>
  if (
    !b || b.v !== 1
    || typeof b.projectUuid !== 'string' || !b.projectUuid
    || !isValidSharedKey(b.sharedKey)
    || typeof b.roomId !== 'string' || !b.roomId
    || typeof b.roomSecret !== 'string' || !b.roomSecret
    || (b.side !== 'creator' && b.side !== 'importer')
    || typeof b.expiresAt !== 'string' || Number.isNaN(Date.parse(b.expiresAt))
  ) {
    throw new Error('not a share link')
  }
  if (shareIsExpired({ expiresAt: b.expiresAt }, at)) throw new ShareLinkExpiredError('share link expired')
  return {
    v: 1,
    projectUuid: b.projectUuid,
    sharedKey: b.sharedKey,
    roomId: b.roomId,
    roomSecret: b.roomSecret,
    side: b.side,
    expiresAt: b.expiresAt,
  }
}
