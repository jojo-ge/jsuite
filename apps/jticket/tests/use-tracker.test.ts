import { describe, expect, it } from 'vitest'
import { bucketCountsOf, bucketOf, isFrontier, type Project, type ProjectShare, type Ticket } from '../app/composables/useTracker'

// The client twin of server/utils/store.test.ts's ticketIsFrontier suite. The
// two rules have to agree ticket-for-ticket: the board rings and dispatches
// whatever this one calls frontier, while `?frontier=true` serves whatever the
// server's does, and TICK-312 is what it costs when they drift.

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1',
  key: 'CART-1',
  title: 'Persist the cart',
  description: '',
  acceptanceCriteria: [],
  type: 'AFK',
  status: 'todo',
  projectId: 'p1',
  assignee: '',
  labels: [],
  resolution: '',
  blockedBy: [],
  comments: [],
  branch: '',
  prompt: '',
  promptMode: '',
  completedAt: null,
  origin: '',
  owner: '',
  transfer: '',
  transferAt: '',
  createdAt: '',
  updatedAt: '',
  ...over,
})

const importerShare: ProjectShare = { key: 'CART', side: 'importer', peerName: 'Avery' }
const creatorShare: ProjectShare = { key: 'CART', side: 'creator', peerName: 'Blake' }
const shared = (share: ProjectShare): Pick<Project, 'share'> => ({ share })
const local: Pick<Project, 'share'> = { share: null }

describe('isFrontier', () => {
  it('takes an open, unblocked, unclaimed ticket', () => {
    const t = ticket()
    expect(isFrontier(t, [t], local)).toBe(true)
  })

  it('drops claimed, non-todo and blocked tickets', () => {
    const dep = ticket({ id: 'dep', key: 'CART-3', status: 'in_progress' })
    const cases = [
      ticket({ assignee: 'claude' }),
      ticket({ status: 'in_progress' }),
      ticket({ status: 'merged' }),
      ticket({ blockedBy: ['dep'] }),
    ]
    for (const t of cases) expect(isFrontier(t, [t, dep], local)).toBe(false)
  })

  it('drops a peer-owned ticket on a shared project', () => {
    // The board used to file this under "Frontier — takeable now" and offer it
    // the herdr button, which the API then refused with a 403.
    const t = ticket({ origin: 'creator', owner: 'creator' })
    expect(isFrontier(t, [t], shared(importerShare))).toBe(false)
    // Symmetric: the creator's copy of a ticket the importer now owns.
    const theirs = ticket({ origin: 'creator', owner: 'importer' })
    expect(isFrontier(theirs, [theirs], shared(creatorShare))).toBe(false)
  })

  it('drops a ticket frozen mid-transfer, whichever way the offer travels', () => {
    // Frozen either way, and a decline stays frozen until the transferor's
    // next pull clears the marker — so all three are undispatchable here.
    const offeredOut = ticket({ origin: 'importer', owner: 'importer', transfer: 'pending' })
    const offeredIn = ticket({ origin: 'creator', owner: 'creator', transfer: 'pending' })
    const declined = ticket({ origin: 'importer', owner: 'importer', transfer: 'declined' })
    for (const t of [offeredOut, offeredIn, declined]) {
      expect(isFrontier(t, [t], shared(importerShare))).toBe(false)
    }
  })

  it('keeps this side’s own tickets on a shared project', () => {
    const mine = ticket({ origin: 'importer', owner: 'importer' })
    expect(isFrontier(mine, [mine], shared(importerShare))).toBe(true)
    // Unstamped = minted here before the project was shared, so it is ours.
    const preShare = ticket({ origin: '', owner: '' })
    expect(isFrontier(preShare, [preShare], shared(importerShare))).toBe(true)
  })

  it('leaves local-only projects untouched', () => {
    const t = ticket()
    expect(isFrontier(t, [t], local)).toBe(true)
    expect(isFrontier(t, [t], null)).toBe(true)
    expect(isFrontier(t, [t], undefined)).toBe(true)
    // No share to judge against ⇒ no ownership, even on a stamped ticket
    // (one whose project was shared and then unshared).
    const stamped = ticket({ origin: 'creator', owner: 'creator' })
    expect(isFrontier(stamped, [stamped], local)).toBe(true)
  })
})

describe('bucketOf', () => {
  it('buckets the four flow states as it always has', () => {
    const dep = ticket({ id: 'dep', key: 'CART-3', status: 'in_progress' })
    expect(bucketOf(ticket(), [], local)).toBe('frontier')
    expect(bucketOf(ticket({ assignee: 'claude' }), [], local)).toBe('claimed')
    expect(bucketOf(ticket({ status: 'in_progress' }), [], local)).toBe('claimed')
    expect(bucketOf(ticket({ blockedBy: ['dep'] }), [dep], local)).toBe('blocked')
    expect(bucketOf(ticket({ status: 'done' }), [], local)).toBe('done')
    expect(bucketOf(ticket({ status: 'merged' }), [], local)).toBe('done')
  })

  it('files peer-owned and transfer-frozen open work as notTakeable', () => {
    const theirs = ticket({ origin: 'creator', owner: 'creator' })
    const frozen = ticket({ origin: 'importer', owner: 'importer', transfer: 'pending' })
    const declined = ticket({ origin: 'importer', owner: 'importer', transfer: 'declined' })
    for (const t of [theirs, frozen, declined]) {
      expect(bucketOf(t, [t], shared(importerShare))).toBe('notTakeable')
    }
  })

  it('does not steal tickets from the buckets that are still true of them', () => {
    // Ownership only ever displaces *open work*. The peer's in-progress ticket
    // really is in progress, their blocked one really is blocked, and their
    // finished one really is resolved — saying otherwise is the same class of
    // lie as calling their todo ticket takeable.
    const dep = ticket({ id: 'dep', key: 'CART-3', status: 'in_progress' })
    const peer = { origin: 'creator', owner: 'creator' } as const
    expect(bucketOf(ticket({ ...peer, status: 'in_progress' }), [], shared(importerShare))).toBe('claimed')
    expect(bucketOf(ticket({ ...peer, assignee: 'avery' }), [], shared(importerShare))).toBe('claimed')
    expect(bucketOf(ticket({ ...peer, blockedBy: ['dep'] }), [dep], shared(importerShare))).toBe('blocked')
    expect(bucketOf(ticket({ ...peer, status: 'done' }), [], shared(importerShare))).toBe('done')
  })

  it('leaves a local-only project bucketed exactly as it was', () => {
    const dep = ticket({ id: 'dep', key: 'CART-3', status: 'in_progress' })
    // Nothing a local-only project can hold reaches the new bucket: there is
    // no share, so no ticket is peer-owned, and nothing gets a transfer stamp
    // without one. Stamps left behind by a project that was shared and then
    // unshared count as ours again.
    const cases: [Ticket, string][] = [
      [ticket(), 'frontier'],
      [ticket({ origin: 'creator', owner: 'creator' }), 'frontier'],
      [ticket({ status: 'in_progress' }), 'claimed'],
      [ticket({ blockedBy: ['dep'] }), 'blocked'],
      [ticket({ status: 'done' }), 'done'],
    ]
    for (const [t, want] of cases) expect(bucketOf(t, [t, dep], local)).toBe(want)
  })

  it('agrees with the server on a transfer stamp with no share behind it', () => {
    // ticketIsFrontier drops `transfer` before it ever looks at the share, so
    // this side must too — the two rules being the same rule is the point, and
    // a residual stamp is not worth a divergence to paper over.
    const stray = ticket({ transfer: 'pending' })
    expect(isFrontier(stray, [stray], local)).toBe(false)
    expect(bucketOf(stray, [stray], local)).toBe('notTakeable')
  })
})

describe('bucketCountsOf', () => {
  it('reports every bucket, zeros included, and accounts for every ticket', () => {
    // A summary view lays its own segments out over this, so a bucket it never
    // sees has to read 0 rather than undefined.
    const dep = ticket({ id: 'dep', key: 'CART-3', status: 'in_progress' })
    const tickets = [ticket(), ticket({ id: 't2', status: 'in_progress' }), ticket({ id: 't3', blockedBy: ['dep'] })]
    const counts = bucketCountsOf(tickets, [...tickets, dep], local)
    expect(counts).toEqual({ frontier: 1, claimed: 1, notTakeable: 0, blocked: 1, done: 0 })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(tickets.length)
  })

  it('does not count the peer’s todo ticket as work this side has not started', () => {
    // TICK-313: the stacked bar carried its own four states and filed this
    // under "not started", which on a shared project reads as though the
    // peer's half were ours to pick up.
    const mine = ticket({ id: 'mine', origin: 'importer', owner: 'importer' })
    const theirs = ticket({ id: 'theirs', origin: 'creator', owner: 'creator' })
    const frozen = ticket({ id: 'frozen', origin: 'importer', owner: 'importer', transfer: 'pending' })
    const all = [mine, theirs, frozen]
    expect(bucketCountsOf(all, all, shared(importerShare))).toEqual({
      frontier: 1,
      claimed: 0,
      notTakeable: 2,
      blocked: 0,
      done: 0,
    })
  })

  it('leaves notTakeable empty on a local-only project', () => {
    // Nothing without a share is peer-owned, so the bucket stays zero and the
    // segment a summary view feeds from it never renders.
    const all = [ticket(), ticket({ id: 't2', origin: 'creator', owner: 'creator' }), ticket({ id: 't3', status: 'done' })]
    for (const project of [local, null, undefined]) {
      expect(bucketCountsOf(all, all, project).notTakeable).toBe(0)
    }
  })

  it('counts an assigned todo ticket as claimed, not as unstarted work', () => {
    // The one place the stacked bar's answer moved. Its old four states only
    // asked `status === 'in_progress'`, so an assigned todo ticket fell
    // through to "not started"; `bucketOf` calls it claimed, which is what
    // the board has always called it. Local-only, so nothing else is in play.
    const assigned = ticket({ assignee: 'claude' })
    expect(bucketCountsOf([assigned], [assigned], local)).toEqual({
      frontier: 0,
      claimed: 1,
      notTakeable: 0,
      blocked: 0,
      done: 0,
    })
  })
})
