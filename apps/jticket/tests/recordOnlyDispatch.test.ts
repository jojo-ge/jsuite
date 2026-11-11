import { createError } from 'h3'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Project, Store, Ticket } from '../server/utils/store'

// The record-only dispatch rule at the doors themselves (TICK-944): every
// ticket dispatch — a card's herdr button, Run all, One session, the review
// plan's /jpr-check runner — goes through dispatchTicketSession or
// dispatchBatchSession, and both refuse a PR review project's finding ticket
// before anything reaches herdr. The rule is tests/reviewFindings.test.ts.

// The dispatch module reads Nitro's auto-imports as globals; these are the two
// the refusals reach. Nothing past the guard runs, so herdr is never touched.
vi.stubGlobal('createError', createError)
vi.stubGlobal('transferFreezeError', () => '')
vi.stubGlobal('peerDispatchError', () => '')

let dispatch: typeof import('../server/utils/herdrDispatch')
beforeAll(async () => {
  dispatch = await import('../server/utils/herdrDispatch')
})

const project = { id: 'p1', key: 'PROJ-7', title: 'PR #12', mode: 'prreview', repo: '/tmp/nowhere', share: null } as unknown as Project
const ticket = (key: string, labels: string[], finding?: Ticket['finding']) =>
  ({ id: key, key, projectId: 'p1', labels, description: '', transfer: '', owner: '', origin: '', ...(finding ? { finding } : {}) }) as unknown as Ticket
const record = ticket('TICK-9', ['hitl', 'jreview', 'review:finding'], { review: 'run-1', id: 'f1', severity: 'high', category: 'correctness' })
const store = { projects: [project], tickets: [record], docs: [] } as unknown as Store

describe('dispatching a record-only finding ticket', () => {
  it('is refused as a single session — whatever the prompt, /jpr-check included', async () => {
    await expect(dispatch.dispatchTicketSession(store, record, '/jpr-check TICK-9')).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: expect.stringMatching(/TICK-9 is a review finding on PROJ-7.*never dispatched/),
    })
  })

  it('is refused inside a batch, even beside a check ticket', async () => {
    const check = ticket('TICK-3', ['afk', 'pr:check'])
    await expect(dispatch.dispatchBatchSession(store, project, [check, record], 'work these')).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: expect.stringMatching(/TICK-9 is a review finding/),
    })
  })
})
