import { describe, expect, it } from 'vitest'
import type { ProjectShare } from './ownership'
import { shareForTicket, ticketIsFrontier, withDerived, type Ticket } from './store'

// The frontier is what an agent takes off `?frontier=true`, so everything it
// excludes is a ticket that would bounce the moment the agent touched it —
// blocked, claimed, mid-transfer, or (TICK-310) the peer's half of a shared
// project, which every mutating and dispatching path refuses with a 403.

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

describe('ticketIsFrontier', () => {
  it('takes an open, unblocked, unclaimed ticket', () => {
    const t = ticket()
    expect(ticketIsFrontier(t, [t], null)).toBe(true)
  })

  it('drops claimed, non-todo, blocked and mid-transfer tickets', () => {
    const dep = ticket({ id: 'dep', key: 'CART-3', status: 'in_progress' })
    const cases = [
      ticket({ assignee: 'claude' }),
      ticket({ status: 'in_progress' }),
      ticket({ blockedBy: ['dep'] }),
      ticket({ transfer: 'pending', owner: 'importer' }),
    ]
    for (const t of cases) expect(ticketIsFrontier(t, [t, dep], null)).toBe(false)
  })

  it('drops a settled peer-owned ticket on a shared project', () => {
    // The wart TICK-310 fixes: the importer holds the creator's settled ticket
    // (transfer already finished, so nothing else marks it) and used to see it
    // on their own frontier.
    const t = ticket({ origin: 'creator', owner: 'creator' })
    expect(ticketIsFrontier(t, [t], importerShare)).toBe(false)
    // Symmetric: the creator's copy of a ticket the importer now owns.
    const theirs = ticket({ origin: 'creator', owner: 'importer' })
    expect(ticketIsFrontier(theirs, [theirs], creatorShare)).toBe(false)
  })

  it('keeps this side’s own tickets on a shared project', () => {
    const mine = ticket({ origin: 'importer', owner: 'importer' })
    expect(ticketIsFrontier(mine, [mine], importerShare)).toBe(true)
    // Unstamped = minted here before the project was shared, so it is ours.
    const preShare = ticket({ origin: '', owner: '' })
    expect(ticketIsFrontier(preShare, [preShare], importerShare)).toBe(true)
  })

  it('leaves local-only projects untouched', () => {
    const t = ticket()
    expect(ticketIsFrontier(t, [t], null)).toBe(true)
    // No share to judge against ⇒ no ownership, even on a stamped ticket
    // (one whose project was shared and then unshared).
    const stamped = ticket({ origin: 'creator', owner: 'creator' })
    expect(ticketIsFrontier(stamped, [stamped], null)).toBe(true)
    expect(ticketIsFrontier(stamped, [stamped], undefined)).toBe(true)
  })
})

describe('withDerived', () => {
  it('reports frontier: false for a peer-owned ticket, blocked/claimed unchanged', () => {
    const t = ticket({ origin: 'creator', owner: 'creator' })
    expect(withDerived(t, [t], importerShare)).toMatchObject({ frontier: false, blocked: false, claimed: false })
    expect(withDerived(t, [t], null)).toMatchObject({ frontier: true })
  })
})

describe('shareForTicket', () => {
  const store = { projects: [{ id: 'p1', share: importerShare }, { id: 'p2', share: null }] }

  it('resolves the share of the ticket’s project', () => {
    expect(shareForTicket(store, ticket({ projectId: 'p1' }))).toEqual(importerShare)
  })

  it('is null for a local-only project, an unknown project and the backlog', () => {
    expect(shareForTicket(store, ticket({ projectId: 'p2' }))).toBe(null)
    expect(shareForTicket(store, ticket({ projectId: 'gone' }))).toBe(null)
    expect(shareForTicket(store, ticket({ projectId: null }))).toBe(null)
  })
})
