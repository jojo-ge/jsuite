import { describe, expect, it } from 'vitest'
import { outcomeDocOf, projectGraphs, type GraphProject, type GraphTicket } from '../app/utils/projectGraphs'

const p = (id: string, title: string, day: number): GraphProject => ({
  id,
  key: id.toUpperCase(),
  title,
  createdAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`,
})
const t = (id: string, projectId: string | null, blockedBy: string[] = []): GraphTicket => ({ id, key: id.toUpperCase(), projectId, blockedBy })

describe('projectGraphs', () => {
  it('links projects through cross-project blockers and names the chain start → end', () => {
    const projects = [p('a', 'Hollywood A', 1), p('b', 'Hollywood B', 2), p('c', 'Hollywood C', 3)]
    const tickets = [t('a1', 'a'), t('a2', 'a', ['a1']), t('b1', 'b', ['a2']), t('b2', 'b', ['a1']), t('c1', 'c', ['b1'])]
    const [g, ...rest] = projectGraphs(projects, tickets)
    expect(rest).toEqual([])
    expect(g).toMatchObject({ id: 'a', name: 'Hollywood A → Hollywood C', projects: ['a', 'b', 'c'], starts: ['a'], ends: ['c'] })
    expect(g!.layer).toEqual({ a: 0, b: 1, c: 2 })
    expect(g!.links.find((l) => l.from === 'a')!.pairs).toEqual([
      { blocker: 'A2', blocked: 'B1' },
      { blocker: 'A1', blocked: 'B2' },
    ])
  })

  it('ignores same-project blockers, the backlog, and projects with no links', () => {
    const projects = [p('a', 'A', 1), p('solo', 'Solo', 2)]
    const tickets = [t('a1', 'a'), t('a2', 'a', ['a1']), t('s1', 'solo'), t('x', null, ['s1']), t('y', 'solo', ['x'])]
    expect(projectGraphs(projects, tickets)).toEqual([])
  })

  it('names a graph with several starts or ends by all of them, and lays out by longest path', () => {
    const projects = [p('a', 'A', 1), p('b', 'B', 2), p('c', 'C', 3), p('d', 'D', 4)]
    // A → C, B → C, A → D, C → D
    const tickets = [t('a1', 'a'), t('b1', 'b'), t('c1', 'c', ['a1', 'b1']), t('d1', 'd', ['a1', 'c1'])]
    const [g] = projectGraphs(projects, tickets)
    expect(g).toMatchObject({ name: 'A, B → D', starts: ['a', 'b'], ends: ['d'] })
    expect(g!.layer).toEqual({ a: 0, b: 0, c: 1, d: 2 })
    expect(g!.projects).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps separate groups as separate graphs, earliest first', () => {
    const projects = [p('x', 'X', 5), p('y', 'Y', 6), p('a', 'A', 1), p('b', 'B', 2)]
    const tickets = [t('x1', 'x'), t('y1', 'y', ['x1']), t('a1', 'a'), t('b1', 'b', ['a1'])]
    expect(projectGraphs(projects, tickets).map((g) => g.name)).toEqual(['A → B', 'X → Y'])
  })

  it('survives a cycle between projects', () => {
    const projects = [p('a', 'A', 1), p('b', 'B', 2)]
    const tickets = [t('a1', 'a'), t('b1', 'b', ['a1']), t('a2', 'a', ['b1'])]
    const [g] = projectGraphs(projects, tickets)
    expect(g).toMatchObject({ name: 'A → B', projects: ['a', 'b'] })
  })
})

describe('outcomeDocOf', () => {
  it("picks the project's latest outcome-labelled doc", () => {
    const d = (key: string, projectId: string, labels: string[], updatedAt: string) => ({ id: key, key, projectId, labels, updatedAt })
    const docs = [
      d('DOC-1', 'a', ['outcome'], '2026-09-01'),
      d('DOC-2', 'a', ['outcome'], '2026-09-03'),
      d('DOC-3', 'a', ['spec'], '2026-09-09'),
      d('DOC-4', 'b', ['outcome'], '2026-09-09'),
    ]
    expect(outcomeDocOf(docs, 'a')?.key).toBe('DOC-2')
    expect(outcomeDocOf(docs, 'c')).toBeNull()
  })
})
