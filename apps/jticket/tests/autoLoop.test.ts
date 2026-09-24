import { describe, expect, it } from 'vitest'
import {
  coerceAutoLoop,
  finishLoop,
  newAutoLoop,
  planStep,
  retryStep,
  type AutoLoop,
  type AutoWorld,
  type AutoWorldTicket,
} from '../app/utils/autoLoop'

const AT = '2026-09-24T00:00:00.000Z'

function loop(patch: Partial<AutoLoop> = {}): AutoLoop {
  return { ...newAutoLoop(AT), enabled: true, ...patch }
}
function t(key: string, patch: Partial<AutoWorldTicket> = {}): AutoWorldTicket {
  return { key, status: 'todo', frontier: true, hitl: false, claimed: false, ...patch }
}
function world(patch: Partial<AutoWorld> = {}): AutoWorld {
  return { tickets: [], prs: [], tip: 'sha-base', review: null, ...patch }
}

describe('planStep — idle', () => {
  it('starts a loop over the AFK frontier, in key order, based at the tip', () => {
    const step = planStep(loop(), world({ tickets: [t('T-10'), t('T-9'), t('T-3', { hitl: true }), t('T-4', { frontier: false })] }))
    expect(step).toEqual({ kind: 'startLoop', tickets: ['T-9', 'T-10'], baseSha: 'sha-base' })
  })

  it('pauses waiting on the human when only HITL tickets are on the frontier', () => {
    const step = planStep(loop(), world({ tickets: [t('T-1', { hitl: true }), t('T-2', { frontier: false })] }))
    expect(step).toMatchObject({ kind: 'pause', reason: 'waiting-human' })
    expect((step as any).detail).toContain('T-1')
  })

  it('stays waiting (no re-pause) while the human pause holds, and resumes by itself', () => {
    const paused = loop({ paused: { reason: 'waiting-human', detail: 'x', at: AT } })
    expect(planStep(paused, world({ tickets: [t('T-1', { hitl: true })] })).kind).toBe('wait')
    expect(planStep(paused, world({ tickets: [t('T-2')] }))).toMatchObject({ kind: 'startLoop', tickets: ['T-2'] })
  })

  it('completes when no open work is left', () => {
    expect(planStep(loop(), world({ tickets: [t('T-1', { status: 'merged', frontier: false })] }))).toEqual({ kind: 'complete' })
  })

  it('turns off straight away when a stop was requested between loops', () => {
    expect(planStep(loop({ stopRequested: true }), world({ tickets: [t('T-1')] }))).toEqual({ kind: 'turnOff' })
  })

  it('pauses when the integration branch does not resolve', () => {
    expect(planStep(loop(), world({ tip: null, tickets: [t('T-1')] }))).toMatchObject({ kind: 'pause', reason: 'no-branch' })
  })
})

describe('planStep — implementing / fixing', () => {
  const implementing = (patch: Partial<AutoLoop> = {}) => loop({ phase: 'implementing', tickets: ['T-1', 'T-2'], baseSha: 'sha-base', ...patch })

  it('dispatches loop tickets not yet dispatched', () => {
    expect(planStep(implementing(), world({ tickets: [t('T-1'), t('T-2')] }))).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-2'] })
  })

  it('never re-dispatches a ticket already claimed in `dispatched`', () => {
    const step = planStep(implementing({ dispatched: { 'T-1': AT } }), world({ tickets: [t('T-1'), t('T-2')] }))
    expect(step).toEqual({ kind: 'dispatchTickets', keys: ['T-2'] })
  })

  it('waits until every loop ticket is finished', () => {
    const step = planStep(
      implementing({ dispatched: { 'T-1': AT, 'T-2': AT } }),
      world({ tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'in_progress', claimed: true })] }),
    )
    expect(step).toEqual({ kind: 'wait', pending: ['T-2'] })
  })

  it("merges the loop tickets' open and conflicted PRs — and only theirs", () => {
    const step = planStep(
      implementing({ dispatched: { 'T-1': AT, 'T-2': AT } }),
      world({
        tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'done' })],
        prs: [
          { key: 'PR-4', ticketKey: 'T-2', status: 'conflicted' },
          { key: 'PR-3', ticketKey: 'T-1', status: 'open' },
          { key: 'PR-5', ticketKey: 'T-9', status: 'open' },
          { key: 'PR-1', ticketKey: 'T-1', status: 'closed' },
        ],
      }),
    )
    expect(step).toEqual({ kind: 'enterMerge', prs: ['PR-3', 'PR-4'] })
  })

  it('skips the merge when there are no PRs: implementing → review, fixing → finish', () => {
    const w = world({ tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'done' }), t('T-7', { status: 'done' })] })
    expect(planStep(implementing({ dispatched: { 'T-1': AT, 'T-2': AT } }), w)).toEqual({ kind: 'enterReview' })
    expect(planStep(loop({ phase: 'fixing', fixTickets: ['T-7'], dispatched: { 'T-7': AT } }), w)).toEqual({ kind: 'finishLoop' })
  })

  it('treats a deleted ticket as finished rather than waiting forever', () => {
    expect(planStep(implementing({ dispatched: { 'T-1': AT, 'T-2': AT } }), world({ tickets: [] }))).toEqual({ kind: 'enterReview' })
  })
})

describe('planStep — merging', () => {
  it('dispatches the sweep once, then waits for every PR to land', () => {
    const merging = loop({ phase: 'merging', prs: ['PR-3', 'PR-4'] })
    expect(planStep(merging, world())).toEqual({ kind: 'dispatchMerge', prs: ['PR-3', 'PR-4'] })
    const dispatched = { ...merging, mergeDispatchedAt: AT }
    expect(
      planStep(dispatched, world({ prs: [{ key: 'PR-3', ticketKey: 'T-1', status: 'merged' }, { key: 'PR-4', ticketKey: 'T-2', status: 'conflicted' }] })),
    ).toEqual({ kind: 'wait', pending: ['PR-4'] })
  })

  it('moves on when all PRs landed: merging → review, merging-fixes → finish', () => {
    const prs = [{ key: 'PR-3', ticketKey: 'T-1', status: 'merged' as const }]
    expect(planStep(loop({ phase: 'merging', prs: ['PR-3'], mergeDispatchedAt: AT }), world({ prs }))).toEqual({ kind: 'enterReview' })
    expect(planStep(loop({ phase: 'merging-fixes', prs: ['PR-3'], mergeDispatchedAt: AT }), world({ prs }))).toEqual({ kind: 'finishLoop' })
  })
})

describe('planStep — reviewing', () => {
  const reviewing = (patch: Partial<AutoLoop> = {}) => loop({ phase: 'reviewing', baseSha: 'sha-base', ...patch })

  it('skips the review when nothing landed this loop', () => {
    expect(planStep(reviewing(), world({ tip: 'sha-base' }))).toEqual({ kind: 'finishLoop' })
  })

  it('asks jReview for a review of the new commits', () => {
    expect(planStep(reviewing(), world({ tip: 'sha-new' }))).toEqual({ kind: 'startReview' })
  })

  it('waits for the consensus session, then fixes what it filed', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: { status: 'triaging', ticketKeys: [] } }))).toEqual({ kind: 'wait', pending: ['r1'] })
    expect(planStep(asked, world({ tip: 'sha-new', review: { status: 'ticketed', ticketKeys: ['T-12', 'T-11'] } }))).toEqual({
      kind: 'enterFix',
      tickets: ['T-11', 'T-12'],
    })
  })

  it('finishes the loop when the reviewers agreed on nothing', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: { status: 'ticketed', ticketKeys: [] } }))).toEqual({ kind: 'finishLoop' })
  })

  it('waits out an unreachable jReview but pauses on a vanished review', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: 'unreachable' })).kind).toBe('wait')
    expect(planStep(asked, world({ tip: 'sha-new', review: 'missing' }))).toMatchObject({ kind: 'pause', reason: 'review-failed' })
  })

  it('pauses when a review was requested but its key never recorded', () => {
    expect(planStep(reviewing({ reviewRequestedAt: AT }), world({ tip: 'sha-new' }))).toMatchObject({ kind: 'pause', reason: 'review-failed' })
  })
})

describe('pauses, retry, finish', () => {
  it('a failed-dispatch pause holds every step until Retry step', () => {
    const paused = loop({ phase: 'implementing', tickets: ['T-1'], paused: { reason: 'dispatch-failed', detail: 'boom', at: AT } })
    expect(planStep(paused, world({ tickets: [t('T-1')] })).kind).toBe('wait')
  })

  it('retry re-dispatches only tickets nobody claimed, and re-asks a sweep or review', () => {
    const state = loop({
      phase: 'implementing',
      tickets: ['T-1', 'T-2'],
      dispatched: { 'T-1': AT, 'T-2': AT },
      paused: { reason: 'dispatch-failed', detail: 'x', at: AT },
    })
    const next = retryStep(state, { tickets: [t('T-1'), t('T-2', { status: 'in_progress', claimed: true })] })
    expect(next.paused).toBeNull()
    expect(next.dispatched).toEqual({ 'T-2': AT })
    expect(retryStep(loop({ phase: 'merging', mergeDispatchedAt: AT }), { tickets: [] }).mergeDispatchedAt).toBe('')
    expect(retryStep(loop({ phase: 'reviewing', reviewRequestedAt: AT, reviewKey: 'r1' }), { tickets: [] })).toMatchObject({
      reviewRequestedAt: '',
      reviewKey: null,
    })
  })

  it('finishLoop records history and starts the next loop — or stops when asked', () => {
    const done = loop({ loop: 3, phase: 'merging-fixes', tickets: ['T-1'], fixTickets: ['T-5'], reviewKey: 'r1', loopStartedAt: AT })
    const next = finishLoop(done, '2026-09-24T01:00:00.000Z')
    expect(next).toMatchObject({ enabled: true, loop: 4, phase: 'idle', tickets: [], stopRequested: false })
    expect(next.history.at(-1)).toMatchObject({ loop: 3, tickets: ['T-1'], fixTickets: ['T-5'], reviewKey: 'r1' })

    const stopped = finishLoop({ ...done, stopRequested: true }, AT)
    expect(stopped).toMatchObject({ enabled: false, stopRequested: false, loop: 4, ended: { reason: 'stopped' } })
  })

  it('coerceAutoLoop survives junk and keeps what is usable', () => {
    expect(coerceAutoLoop(null)).toBeNull()
    const c = coerceAutoLoop({ enabled: true, phase: 'nonsense', loop: -1, tickets: ['T-1', 3], dispatched: { 'T-1': AT } })!
    expect(c).toMatchObject({ enabled: true, phase: 'idle', loop: 1, tickets: ['T-1'], dispatched: { 'T-1': AT } })
  })
})
