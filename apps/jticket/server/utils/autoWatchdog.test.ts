import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as store from './store'
import * as ownership from './ownership'
import type { Project, Store, Ticket } from './store'

// forceCloseTicket leans on Nitro auto-imports; hand it the real ones.
let mod: typeof import('./autoLoop')
beforeAll(async () => {
  for (const [name, fn] of Object.entries({ ...store, ...ownership })) if (typeof fn === 'function') vi.stubGlobal(name, fn)
  mod = await import('./autoLoop')
})

describe('auto loop hand-off lines', () => {
  it('tells a dispatched session to always finish done, on one line', () => {
    const line = mod.autoTicketInstruction('TICK-7', 'PROJ-2')
    expect(line).not.toContain('\n')
    expect(line).toContain('always finish with TICK-7 marked done')
    expect(line).toContain('new AFK ticket in PROJ-2')
  })

  it('nudges a stalled session on one line', () => {
    const line = mod.autoNudgePrompt('TICK-7', 'PROJ-2')
    expect(line).not.toContain('\n')
    expect(line).toContain('mark TICK-7 done')
  })
})

describe('forceCloseTicket', () => {
  const AT = '2026-09-25T00:00:00.000Z'
  const project = { id: 'p1', key: 'PROJ-1', share: null } as unknown as Project
  const ticket = (id: string, key: string, patch: Partial<Ticket> = {}) =>
    ({
      id, key, title: `Title ${key}`, description: 'Build it.', acceptanceCriteria: ['works'], type: 'feature',
      status: 'in_progress', projectId: 'p1', assignee: 'claude', labels: ['afk'], resolution: '', blockedBy: [],
      comments: [], branch: `tick/${key}`, prompt: '', promptMode: '', completedAt: null, origin: '', owner: '',
      transfer: '', transferAt: '', createdAt: AT, updatedAt: AT, ...patch,
    }) as Ticket
  const world = (): Store =>
    ({
      projects: [project],
      tickets: [
        ticket('t1', 'TICK-1', { resolution: 'Half of it.' }),
        ticket('t2', 'TICK-2', { status: 'todo', assignee: '', blockedBy: ['t1'] }),
        ticket('t3', 'TICK-3', { status: 'todo', assignee: '', blockedBy: ['t1'], projectId: 'p2' }),
        ticket('t4', 'TICK-4', { status: 'merged', blockedBy: ['t1'] }),
      ],
      prs: [{ key: 'PR-5', ticketId: 't1', status: 'open' }],
      docs: [],
      counters: { ticket: 10 },
    }) as unknown as Store

  it('closes the ticket, explains why, and files the rest as a carryover that inherits its blocks', () => {
    const s = world()
    const carry = mod.forceCloseTicket(s, project, 'TICK-1', 'its session is gone')!
    const closed = s.tickets.find((t) => t.key === 'TICK-1')!
    expect(closed.status).toBe('done')
    expect(closed.completedAt).toBeTruthy()
    expect(closed.resolution).toMatch(/^Half of it\.\n\n---\n\n\*\*Closed by the auto loop: its session is gone\. Whatever is left is TICK-\d+\.\*\*$/)
    expect(closed.comments.at(-1)).toMatchObject({ author: 'jticket auto loop' })

    expect(carry).toMatchObject({ status: 'todo', projectId: 'p1', title: 'Finish TICK-1: Title TICK-1', acceptanceCriteria: ['works'] })
    expect(carry.labels).toEqual(['afk', 'auto-loop:carryover'])
    expect(carry.description).toContain('PR-5')
    expect(carry.description).toContain('Build it.')
    // Open dependents — here or in another project — now wait on the carryover too; finished ones are untouched.
    expect(s.tickets.find((t) => t.key === 'TICK-2')!.blockedBy).toEqual(['t1', carry.id])
    expect(s.tickets.find((t) => t.key === 'TICK-3')!.blockedBy).toEqual(['t1', carry.id])
    expect(s.tickets.find((t) => t.key === 'TICK-4')!.blockedBy).toEqual(['t1'])
  })

  it('files a second carryover of the same work as HITL', () => {
    const s = world()
    s.tickets[0]!.labels = ['afk', 'auto-loop:carryover']
    expect(mod.forceCloseTicket(s, project, 'TICK-1', 'x')!.labels).toEqual(['hitl', 'auto-loop:carryover'])
  })

  it('leaves a finished ticket alone', () => {
    const s = world()
    s.tickets[0]!.status = 'done'
    expect(mod.forceCloseTicket(s, project, 'TICK-1', 'x')).toBeNull()
    expect(s.tickets).toHaveLength(4)
  })
})
