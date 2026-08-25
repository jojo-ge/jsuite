// Ownership partitioning + parity keys (TICK-291, spec DOC-30).
// Pure-logic tests, run with the built-in runner — no test deps:
//   node --test apps/jticket/server/utils/ownership.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  otherSide,
  entityOwnership,
  isPeerOwned,
  peerWriteError,
  peerDispatchError,
  projectMetadataError,
  projectMoveError,
  sharedTicketKey,
  armCreatorShare,
  transferFreezeError,
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  type Owned,
  type ProjectShare,
  type TransferState,
} from './ownership.ts'

const creatorShare: ProjectShare = { key: 'AB', side: 'creator', peerName: 'sam' }
const importerShare: ProjectShare = { key: 'AB', side: 'importer', peerName: 'alex' }

test('otherSide flips between the two sides', () => {
  assert.equal(otherSide('creator'), 'importer')
  assert.equal(otherSide('importer'), 'creator')
})

// ── Stamping new entities ───────────────────────────────────────────────────

test('entityOwnership on a local-only project stamps nothing', () => {
  assert.deepEqual(entityOwnership(null), { origin: '', owner: '' })
  assert.deepEqual(entityOwnership(undefined), { origin: '', owner: '' })
})

test('entityOwnership stamps both fields with the local side', () => {
  assert.deepEqual(entityOwnership(creatorShare), { origin: 'creator', owner: 'creator' })
  assert.deepEqual(entityOwnership(importerShare), { origin: 'importer', owner: 'importer' })
})

// ── Peer-ownership checks ───────────────────────────────────────────────────

test('nothing is peer-owned on a local-only project', () => {
  assert.equal(isPeerOwned({ owner: 'importer' }, null), false)
  assert.equal(isPeerOwned({ owner: '' }, undefined), false)
})

test('an entity owned by the other side is peer-owned', () => {
  assert.equal(isPeerOwned({ owner: 'importer' }, creatorShare), true)
  assert.equal(isPeerOwned({ owner: 'creator' }, importerShare), true)
})

test('an entity owned by this side — or unstamped — is not peer-owned', () => {
  assert.equal(isPeerOwned({ owner: 'creator' }, creatorShare), false)
  assert.equal(isPeerOwned({ owner: 'importer' }, importerShare), false)
  // Unstamped = minted locally before the share existed; it lives here.
  assert.equal(isPeerOwned({ owner: '' }, creatorShare), false)
})

test('peerWriteError allows own and local writes', () => {
  assert.equal(peerWriteError({ key: 'TICK-1', owner: '' }, null), null)
  assert.equal(peerWriteError({ key: 'AB-1', owner: 'creator' }, creatorShare), null)
})

test('peerWriteError refuses a peer-owned write, naming the peer', () => {
  const err = peerWriteError({ key: 'AB-2', owner: 'importer' }, creatorShare)
  assert.ok(err)
  assert.match(err, /AB-2/)
  assert.match(err, /sam/)
})

test('peerDispatchError blocks dispatching a peer-owned ticket only', () => {
  assert.equal(peerDispatchError({ key: 'AB-1', owner: 'creator' }, creatorShare), null)
  assert.equal(peerDispatchError({ key: 'TICK-9', owner: '' }, null), null)
  const err = peerDispatchError({ key: 'AB-2', owner: 'importer' }, creatorShare)
  assert.ok(err)
  assert.match(err, /AB-2/)
  assert.match(err, /sam/)
})

// ── Project metadata (title/description/mode belong to the link creator) ───

test('projectMetadataError lets the creator — and local projects — edit', () => {
  assert.equal(projectMetadataError(null), null)
  assert.equal(projectMetadataError(creatorShare), null)
})

test('projectMetadataError refuses the importer, naming the peer', () => {
  const err = projectMetadataError(importerShare)
  assert.ok(err)
  assert.match(err, /alex/)
})

// ── Moving entities between projects ───────────────────────────────────────
// A shared project's partition is built at minting time (parity key +
// ownership stamp); moving an entity across the share boundary would smuggle
// in an unstamped, non-parity entity — refused in both directions.

test('projectMoveError allows moves between local-only projects', () => {
  assert.equal(projectMoveError(null, null), null)
  assert.equal(projectMoveError(undefined, null), null)
})

test('projectMoveError refuses moving into a shared project', () => {
  assert.ok(projectMoveError(null, creatorShare))
})

test('projectMoveError refuses moving out of a shared project', () => {
  assert.ok(projectMoveError(creatorShare, null))
  assert.ok(projectMoveError(importerShare, undefined))
})

test('projectMoveError refuses moves between shared projects', () => {
  assert.ok(projectMoveError(creatorShare, importerShare))
})

// ── Parity key minting ──────────────────────────────────────────────────────

test('first mint: creator starts at 1, importer at 2', () => {
  assert.equal(sharedTicketKey(creatorShare, []), 'AB-1')
  assert.equal(sharedTicketKey(importerShare, []), 'AB-2')
})

test('minting continues from the highest same-parity number, skipping the peer half', () => {
  const tickets = [{ key: 'AB-1' }, { key: 'AB-2' }, { key: 'AB-3' }, { key: 'AB-4' }]
  assert.equal(sharedTicketKey(creatorShare, tickets), 'AB-5')
  assert.equal(sharedTicketKey(importerShare, tickets), 'AB-6')
})

test('gaps do not confuse the mint — only the max of this parity matters', () => {
  assert.equal(sharedTicketKey(creatorShare, [{ key: 'AB-7' }]), 'AB-9')
  assert.equal(sharedTicketKey(importerShare, [{ key: 'AB-8' }, { key: 'AB-2' }]), 'AB-10')
})

test('legacy TICK keys and other prefixes are ignored', () => {
  const tickets = [{ key: 'TICK-7' }, { key: 'ABC-11' }, { key: 'AB-3' }]
  assert.equal(sharedTicketKey(creatorShare, tickets), 'AB-5')
})

test('a peer number never sets the pace for this side', () => {
  // Importer has minted far ahead; creator still just takes its own next odd.
  const tickets = [{ key: 'AB-2' }, { key: 'AB-100' }]
  assert.equal(sharedTicketKey(creatorShare, tickets), 'AB-1')
})

// ── Arming the creator side (TICK-302) ──────────────────────────────────────

test('the first share arms project.share with the creator side and the peer name', () => {
  const project: { share: ProjectShare | null } = { share: null }
  armCreatorShare(project, 'AB', 'sam', [])
  assert.deepEqual(project.share, { key: 'AB', side: 'creator', peerName: 'sam' })
})

test('arming stamps unstamped entities with the creator side', () => {
  const project: { share: ProjectShare | null } = { share: null }
  const preShare: Owned[] = [
    { origin: '', owner: '' },
    { origin: '', owner: '' },
  ]
  armCreatorShare(project, 'AB', 'sam', preShare)
  for (const e of preShare) assert.deepEqual(e, { origin: 'creator', owner: 'creator' })
})

test('arming never touches stamped entities — the peer half survives a re-share', () => {
  const project: { share: ProjectShare | null } = { share: creatorShare }
  const peers: Owned = { origin: 'importer', owner: 'importer' }
  const transferred: Owned = { origin: 'importer', owner: 'creator' }
  armCreatorShare(project, 'AB', 'sam', [peers, transferred])
  assert.deepEqual(peers, { origin: 'importer', owner: 'importer' })
  assert.deepEqual(transferred, { origin: 'importer', owner: 'creator' })
})

test('re-arming an armed project keeps the share and refreshes only a given peer name', () => {
  const project: { share: ProjectShare | null } = { share: { key: 'AB', side: 'creator', peerName: 'sam' } }
  armCreatorShare(project, 'AB', '', [])
  assert.deepEqual(project.share, { key: 'AB', side: 'creator', peerName: 'sam' })
  armCreatorShare(project, 'AB', 'samantha', [])
  assert.deepEqual(project.share, { key: 'AB', side: 'creator', peerName: 'samantha' })
})

test('re-arming still stamps entities the first arm missed — self-healing for pre-fix shares', () => {
  // A share cut before arming existed: project.share armed later, entities from
  // before the share still unstamped.
  const project: { share: ProjectShare | null } = { share: { key: 'AB', side: 'creator', peerName: 'sam' } }
  const legacy: Owned = { origin: '', owner: '' }
  armCreatorShare(project, 'AB', '', [legacy])
  assert.deepEqual(legacy, { origin: 'creator', owner: 'creator' })
})

// ── Ownership transfer (TICK-295) ───────────────────────────────────────────
// The pure state machine: initiate flips owner to the peer and freezes;
// accept settles the transferee's copy; decline bounces ownership back and
// leaves the marker the snapshot's transferDeclines entry is built from.

const T1 = '2026-08-24T11:00:00.000Z'

function transferable(over: Partial<TransferState> = {}): TransferState {
  return { key: 'AB-1', origin: 'creator', owner: 'creator', transfer: '', transferAt: '', ...over }
}

test('a pending transfer freezes the ticket on both sides; settled and declined states do not', () => {
  assert.equal(transferFreezeError(transferable(), creatorShare), null)
  // The transferor's copy (owner already the peer) and the transferee's copy
  // (owner this side) are both frozen while pending.
  const out = transferable({ owner: 'importer', transfer: 'pending', transferAt: T1 })
  const offered = transferable({ owner: 'creator', transfer: 'pending', transferAt: T1 })
  assert.match(transferFreezeError(out, creatorShare)!, /transfer/)
  assert.match(transferFreezeError(offered, creatorShare)!, /transfer/)
  assert.equal(transferFreezeError(transferable({ transfer: 'declined', owner: 'importer', transferAt: T1 }), creatorShare), null)
})

test('initiate flips owner to the peer, marks pending, stamps the offer time', () => {
  const t = transferable()
  assert.equal(initiateTransfer(t, creatorShare, T1), null)
  assert.deepEqual(t, { key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1 })
})

test('initiate stamps an unstamped pre-share ticket with this side as origin', () => {
  const t = transferable({ origin: '', owner: '' })
  assert.equal(initiateTransfer(t, creatorShare, T1), null)
  assert.deepEqual(t, { key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1 })
})

test('initiate refuses without a share, on a peer-owned ticket, and while already in transfer', () => {
  const local = transferable()
  assert.match(initiateTransfer(local, null)!, /shared/)
  const theirs = transferable({ origin: 'importer', owner: 'importer' })
  assert.match(initiateTransfer(theirs, creatorShare)!, /owned by sam/)
  const pending = transferable({ owner: 'importer', transfer: 'pending', transferAt: T1 })
  assert.match(initiateTransfer(pending, creatorShare)!, /transfer/)
})

test('accept settles the offered copy as plainly owned', () => {
  const offered = transferable({ origin: 'importer', owner: 'creator', transfer: 'pending', transferAt: T1 })
  assert.equal(acceptTransfer(offered, creatorShare), null)
  assert.deepEqual(offered, { key: 'AB-1', origin: 'importer', owner: 'creator', transfer: '', transferAt: '' })
})

test('accept and decline only work on the side the ticket is offered to', () => {
  // The transferor's own pending copy (owner = peer) cannot self-accept.
  const out = transferable({ owner: 'importer', transfer: 'pending', transferAt: T1 })
  assert.match(acceptTransfer(out, creatorShare)!, /offered/)
  assert.match(declineTransfer(out, creatorShare)!, /offered/)
  const settled = transferable()
  assert.match(acceptTransfer(settled, creatorShare)!, /offered/)
})

test('decline bounces ownership back and keeps the offer stamp for the wire marker', () => {
  const offered = transferable({ origin: 'importer', owner: 'creator', transfer: 'pending', transferAt: T1 })
  assert.equal(declineTransfer(offered, creatorShare), null)
  assert.deepEqual(offered, { key: 'AB-1', origin: 'importer', owner: 'importer', transfer: 'declined', transferAt: T1 })
})
