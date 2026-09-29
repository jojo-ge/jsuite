import { describe, expect, it } from 'vitest'
import { lastActivity, moveBy, moveTo, shortAge, sortByOrder } from '../app/utils/projectOrder'

const p = (key: string, position: number | null, day = 1) => ({
  key,
  position,
  createdAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`,
})

describe('sortByOrder', () => {
  it('puts never-placed projects first, newest first, then the manual order', () => {
    const sorted = sortByOrder([p('PROJ-1', 1), p('PROJ-2', null, 3), p('PROJ-3', 0), p('PROJ-4', null, 9)])
    expect(sorted.map((x) => x.key)).toEqual(['PROJ-4', 'PROJ-2', 'PROJ-3', 'PROJ-1'])
  })
  it('breaks position ties by key number', () => {
    expect(sortByOrder([p('PROJ-10', 0), p('PROJ-9', 0)]).map((x) => x.key)).toEqual(['PROJ-9', 'PROJ-10'])
  })
  it('handles negative positions from unhiding', () => {
    expect(sortByOrder([p('PROJ-1', 0), p('PROJ-2', -1)]).map((x) => x.key)).toEqual(['PROJ-2', 'PROJ-1'])
  })
})

describe('moveBy / moveTo', () => {
  it('steps one place and stops at the ends', () => {
    expect(moveBy(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })
  it('drops before or after a target', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b'])
  })
})

describe('lastActivity / shortAge', () => {
  const now = new Date('2026-09-29T12:00:00.000Z')
  it('takes the newest ticket edit', () => {
    expect(lastActivity([{ updatedAt: '2026-09-01T00:00:00Z' }, { updatedAt: '2026-09-20T00:00:00Z' }])).toBe('2026-09-20T00:00:00Z')
    expect(lastActivity([])).toBeNull()
  })
  it('shortens ages', () => {
    expect(shortAge(null, now)).toBe('—')
    expect(shortAge('2026-09-29T08:00:00Z', now)).toBe('today')
    expect(shortAge('2026-09-26T08:00:00Z', now)).toBe('3d')
    expect(shortAge('2026-09-07T08:00:00Z', now)).toBe('3w')
    expect(shortAge('2026-07-01T08:00:00Z', now)).toBe('3mo')
  })
})
