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

// Arming the creator side at share time — the share flow's half of the
// partition (the importer's half is the import screen, which creates its
// project already armed). The first share sets project.share; every share
// stamps the entities that predate it, since unstamped ('') means minted on
// this machine before the project was shared. Idempotent: an armed project
// only has its peerName refreshed (when one is given), and stamped entities —
// including the peer's after a sync — are never touched.
export function armCreatorShare(
  project: { share: ProjectShare | null },
  key: string,
  peerName: string,
  entities: Iterable<Owned>,
): void {
  if (!project.share) project.share = { key, side: 'creator', peerName }
  else if (peerName) project.share.peerName = peerName
  for (const e of entities) {
    if (!e.origin && !e.owner) {
      e.origin = 'creator'
      e.owner = 'creator'
    }
  }
}

// ── Ownership transfer (TICK-295, spec DOC-30) ──────────────────────────────
// Tickets (never docs) change sides via a two-phase protocol that survives
// pull-only snapshots. The state machine lives here; sync.ts moves the states
// across the wire. During limbo the record is identical on both machines:
// owner already names the transferee, transfer: 'pending' — frozen (no edits,
// no dispatch) and immune to absence-deletion everywhere. `origin` never
// changes: parity is fixed at minting for the ticket's lifetime.

/** The transfer-bearing slice of a Ticket — keeps this module store-free. */
export interface TransferState extends Owned {
  key?: string
  transfer: '' | 'pending' | 'declined'
  transferAt: string
}

// The freeze: a pending transfer blocks edits, deletion, branch cuts and
// dispatch on BOTH machines — the transferor's copy is peer-owned anyway, but
// the transferee's copy carries this side's owner before acceptance, and only
// this guard keeps it read-only and undispatchable until the human accepts.
export function transferFreezeError(
  ticket: TransferState,
  share: ProjectShare | null | undefined,
): string | null {
  if (!share || ticket.transfer !== 'pending') return null
  // Owner reading as this side = the offer is TO this side, so the actor who
  // must answer is the local human, not the peer.
  if (ticket.owner === share.side) {
    return `${ticket.key ?? 'this ticket'} is an unanswered transfer offer from ${share.peerName} — accept or decline it first`
  }
  return `${ticket.key ?? 'this ticket'} is mid-transfer — frozen until ${share.peerName} accepts or declines`
}

// Initiate: this side's ticket becomes the peer's-pending. The transferAt
// stamp identifies the offer — a decline names it, so a stale decline can
// never kill a later re-offer. An unstamped (pre-share) ticket is stamped
// with this side as origin first: it was minted here.
export function initiateTransfer(
  ticket: TransferState,
  share: ProjectShare | null | undefined,
  at: string = new Date().toISOString(),
): string | null {
  if (!share) return 'only tickets on a shared project can be transferred'
  // In-transfer first: the transferor's own pending copy is peer-owned too,
  // and "already in transfer" is the truth of that state.
  if (ticket.transfer !== '') {
    return `${ticket.key ?? 'this ticket'} is already in transfer (${ticket.transfer})`
  }
  const refused = peerWriteError(ticket, share)
  if (refused) return refused
  if (!ticket.origin) ticket.origin = share.side
  ticket.owner = otherSide(share.side)
  ticket.transfer = 'pending'
  ticket.transferAt = at
  return null
}

// A ticket is an open offer to THIS side when it is pending and its owner
// already names this side — exactly the state a pulled offer lands in.
function offeredHereError(ticket: TransferState, share: ProjectShare): string | null {
  if (ticket.transfer === 'pending' && ticket.owner === share.side) return null
  return `${ticket.key ?? 'this ticket'} is not offered to this side`
}

// Accept: the offer becomes a plain owned ticket — editable, dispatchable,
// exported as this side's from the next pull on. That export is what lets the
// transferor finalize (drop their frozen copy by wholesale replace).
export function acceptTransfer(ticket: TransferState, share: ProjectShare | null | undefined): string | null {
  if (!share) return 'only tickets on a shared project can be transferred'
  const refused = offeredHereError(ticket, share)
  if (refused) return refused
  ticket.transfer = ''
  ticket.transferAt = ''
  return null
}

// Decline: ownership bounces straight back to the peer; the 'declined' marker
// (with the offer's transferAt) is what buildSyncExport turns into the
// transferDeclines entry the transferor reverts on. The marker clears when
// the peer re-exports the ticket as plainly theirs.
export function declineTransfer(ticket: TransferState, share: ProjectShare | null | undefined): string | null {
  if (!share) return 'only tickets on a shared project can be transferred'
  const refused = offeredHereError(ticket, share)
  if (refused) return refused
  ticket.owner = otherSide(share.side)
  ticket.transfer = 'declined'
  return null
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
