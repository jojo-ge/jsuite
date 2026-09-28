import { describe, expect, it } from 'vitest'
import { forecastLoopOf, forecastLoops, type ForecastTicket } from '../app/utils/autoForecast'

const t = (id: string, blockedBy: string[] = [], over: Partial<ForecastTicket> = {}): ForecastTicket => ({
  id,
  inProject: true,
  open: true,
  hitl: false,
  takeable: true,
  running: false,
  blockedBy,
  ...over,
})

describe('forecastLoops', () => {
  it('runs one loop per layer of the blocker graph', () => {
    const f = forecastLoops([t('A'), t('B'), t('C', ['A']), t('D', ['C', 'B']), t('E', ['A'])])
    expect(f.loops).toEqual([['A', 'B'], ['C', 'E'], ['D']])
    expect(f.gated).toEqual([])
    expect(forecastLoopOf(f, 'D')).toBe(3)
  })

  it('skips finished tickets and counts them as cleared blockers', () => {
    const f = forecastLoops([t('A', [], { open: false }), t('B', ['A'])])
    expect(f.loops).toEqual([['B']])
  })

  it('treats running work as finished by the end of loop 1, but never puts it in a loop', () => {
    const f = forecastLoops([t('A', [], { running: true, takeable: false }), t('B'), t('C', ['A'])])
    expect(f.loops).toEqual([['B'], ['C']])
  })

  it('with nothing takeable now, the first loop is whatever running work frees', () => {
    const f = forecastLoops([t('A', [], { running: true, takeable: false }), t('B', ['A'])])
    expect(f.loops).toEqual([['B']])
  })

  it('gates HITL tickets, the peer’s open work, and everything behind them', () => {
    const f = forecastLoops([
      t('A'),
      t('H', ['A'], { hitl: true }),
      t('X', ['H']),
      t('P', [], { takeable: false }),
      t('Q', ['P']),
    ])
    expect(f.loops).toEqual([['A']])
    expect(f.gated).toEqual(['H', 'X', 'P', 'Q'])
    expect(forecastLoopOf(f, 'X')).toBe(0)
  })

  it("waits on another project's running work, but not its unstarted work", () => {
    const f = forecastLoops([
      t('ext-run', [], { inProject: false, running: true, takeable: false }),
      t('ext-todo', [], { inProject: false }),
      t('A', ['ext-run']),
      t('B', ['ext-todo']),
    ])
    expect(f.loops).toEqual([['A']])
    expect(f.gated).toEqual(['B'])
  })

  it('mid-loop, the loop in progress is loop 1 and today’s frontier waits for loop 2', () => {
    const f = forecastLoops(
      [t('A', [], { running: true, takeable: false }), t('B'), t('C', ['A'])],
      ['A'],
    )
    expect(f.loops).toEqual([['A'], ['B', 'C']])
  })

  it('ignores blockers it knows nothing about', () => {
    expect(forecastLoops([t('A', ['gone'])]).loops).toEqual([['A']])
  })
})
