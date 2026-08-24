// Ownership partitioning for shared projects (spec DOC-30).
//
// A shared project has exactly two participants. Sides are named, not
// machine-relative — 'creator' made the share link, 'importer' accepted it —
// so an exported snapshot means the same thing on both machines. Each machine
// knows which side it is from its project's `share.side`; an entity whose
// `owner` is the other side is the peer's, and the peer's half is untouchable:
// every local write or dispatch against it is refused at the API.
//
// Pure logic, no imports — exhaustively unit-tested (ownership.test.ts) and
// shared by every handler that mints or guards an entity.

/** Which half of a shared project something belongs to. */
export type ShareSide = 'creator' | 'importer'

// The share as the *project record* sees it — enough to partition ownership
// and mint parity keys. The link/room lifecycle (secrets, expiry) is the share
// flow's own record and lives with it, not here.
export interface ProjectShare {
  /** The 1–4 char shared ticket-key prefix both sides mint under (e.g. 'AB'). */
  key: string
  /** Which side THIS machine is. */
  side: ShareSide
  /** The other participant's display name — what peer-owned badges show. */
  peerName: string
}

/** Ownership stamped on tickets, docs and comments. '' on local-only projects. */
export interface Owned {
  /** The side that minted the entity. Immutable — it fixes key parity. */
  origin: ShareSide | ''
  /** The side the entity belongs to now. Mutable only by ownership transfer. */
  owner: ShareSide | ''
}

export function otherSide(side: ShareSide): ShareSide {
  return side === 'creator' ? 'importer' : 'creator'
}

// The stamp for a newly-minted entity: on a shared project it starts on (and
// stays keyed to) the minting side; on a local project both fields stay ''.
export function entityOwnership(share: ProjectShare | null | undefined): Owned {
  if (!share) return { origin: '', owner: '' }
  return { origin: share.side, owner: share.side }
}

// An unstamped owner ('' — minted locally, e.g. before the share existed)
// lives on this machine and is never the peer's.
export function isPeerOwned(entity: { owner: ShareSide | '' }, share: ProjectShare | null | undefined): boolean {
  if (!share || !entity.owner) return false
  return entity.owner !== share.side
}

// The refusal for any local write (PATCH, DELETE, branch cut) against a
// peer-owned entity — null when the write is allowed. Handlers throw it as 403.
export function peerWriteError(
  entity: { key?: string; owner: ShareSide | '' },
  share: ProjectShare | null | undefined,
): string | null {
  if (!isPeerOwned(entity, share)) return null
  return `${entity.key ?? 'this entity'} is owned by ${share!.peerName} — peer-owned entities are read-only on this side`
}

// The refusal for dispatching a peer-owned ticket into herdr. Same partition
// as writes, its own message: sync moves data only, humans dispatch — and only
// their own half (spec DOC-30, invariant 3).
export function peerDispatchError(
  entity: { key?: string; owner: ShareSide | '' },
  share: ProjectShare | null | undefined,
): string | null {
  if (!isPeerOwned(entity, share)) return null
  return `${entity.key ?? 'this ticket'} is owned by ${share!.peerName} — peer-owned tickets cannot be dispatched; mint your own ticket instead`
}

// Project metadata (title, description, mode) belongs to the link creator.
// Machine-local fields (repo, integration branch, starred) stay editable on
// both sides and never cross the wire.
export function projectMetadataError(share: ProjectShare | null | undefined): string | null {
  if (!share || share.side === 'creator') return null
  return `this project's title, description and mode belong to ${share.peerName} (the share's creator)`
}

// A shared project's partition is built at minting time — parity key plus
// ownership stamp. Moving an existing entity across the share boundary (in
// either direction, or between two shares) would smuggle in an unstamped,
// non-parity entity that both sides could edit after a sync, so it is refused;
// moves between local-only projects stay free.
export function projectMoveError(
  from: ProjectShare | null | undefined,
  to: ProjectShare | null | undefined,
): string | null {
  if (!from && !to) return null
  return 'entities cannot move into or out of a shared project — mint a new one there instead'
}

// Next ticket key on a shared project: '<KEY>-<n>' where n follows the side's
// parity — creator odd, importer even — so both machines mint identical keys
// with zero coordination. Derived from the tickets already in the project (max
// same-parity number + 2), not a counter, so it self-heals across pulls.
// Legacy 'TICK-n' keys and other prefixes don't participate.
export function sharedTicketKey(share: ProjectShare, projectTickets: Array<{ key: string }>): string {
  const start = share.side === 'creator' ? 1 : 2
  let max = start - 2
  for (const t of projectTickets) {
    const [prefix, num] = t.key.split('-')
    if (prefix !== share.key) continue
    const n = Number.parseInt(num ?? '', 10)
    if (!Number.isInteger(n) || n % 2 !== start % 2) continue
    if (n > max) max = n
  }
  return `${share.key}-${max + 2}`
}
