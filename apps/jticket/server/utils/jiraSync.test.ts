import { describe, expect, it } from 'vitest'
import { categoryOf, reconcile } from './jiraSync'

const OLD = '2026-10-16T01:00:00.000Z'
const NEW = '2026-10-16T02:00:00.000Z'
const base = { title: 'A', status: 'todo' as const }

describe('reconcile', () => {
  it('changes nothing when both sides agree', () => {
    expect(reconcile({ ...base, updatedAt: NEW }, { ...base, updatedAt: OLD }, base)).toEqual({ toLocal: {}, toRemote: {}, next: base })
  })

  it('pushes a jTicket edit to Jira', () => {
    const r = reconcile({ title: 'B', status: 'done', updatedAt: OLD }, { ...base, updatedAt: NEW }, base)
    expect(r).toEqual({ toLocal: {}, toRemote: { title: 'B', status: 'done' }, next: { title: 'B', status: 'done' } })
  })

  it('pulls a Jira edit into jTicket', () => {
    const r = reconcile({ ...base, updatedAt: NEW }, { title: 'C', status: 'in_progress', updatedAt: OLD }, base)
    expect(r).toEqual({ toLocal: { title: 'C', status: 'in_progress' }, toRemote: {}, next: { title: 'C', status: 'in_progress' } })
  })

  it('merges per field: each side keeps the field only it changed', () => {
    const r = reconcile({ title: 'B', status: 'todo', updatedAt: OLD }, { title: 'A', status: 'done', updatedAt: NEW }, base)
    expect(r).toEqual({ toLocal: { status: 'done' }, toRemote: { title: 'B' }, next: { title: 'B', status: 'done' } })
  })

  it('lets the more recently updated side win when both changed a field', () => {
    expect(reconcile({ title: 'B', status: 'todo', updatedAt: NEW }, { title: 'C', status: 'todo', updatedAt: OLD }, base).toRemote).toEqual({ title: 'B' })
    expect(reconcile({ title: 'B', status: 'todo', updatedAt: OLD }, { title: 'C', status: 'todo', updatedAt: NEW }, base).toLocal).toEqual({ title: 'C' })
  })

  it('takes Jira on a ticket seen for the first time', () => {
    const r = reconcile({ title: 'B', status: 'todo', updatedAt: NEW }, { title: 'C', status: 'done', updatedAt: OLD }, undefined)
    expect(r.toLocal).toEqual({ title: 'C', status: 'done' })
    expect(r.toRemote).toEqual({})
  })

  it('reads merged as done', () => {
    expect(categoryOf('merged')).toBe('done')
  })
})
