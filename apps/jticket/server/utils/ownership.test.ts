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
  type ProjectShare,
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
