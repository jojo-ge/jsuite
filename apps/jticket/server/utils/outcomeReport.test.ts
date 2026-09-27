import { describe, expect, it } from 'vitest'
import { outcomeReportPrompt } from './outcomeReport'

const project = { key: 'PROJ-7', title: 'Hollywood A', repo: '~/code/hollywood', integrationBranch: 'hollywood' }

describe('outcomeReportPrompt', () => {
  it('asks for a ≤500-word report, a new outcome doc, and the report-back', () => {
    const prompt = outcomeReportPrompt({ project, existingDoc: null, merged: [{ pr: 'PR-3', sha: 'abcdef1234567890', title: 'Cast list' }] })
    expect(prompt).not.toContain('\n')
    expect(prompt).toContain('at most 500 words')
    expect(prompt).toContain('PR-3 abcdef123456 "Cast list"')
    expect(prompt).toContain('POST http://localhost:43000/api/docs with {"title": "PROJ-7 outcome report — Hollywood A", "project": "PROJ-7", "labels": ["outcome"]')
    expect(prompt).toContain('POST http://localhost:43000/api/projects/PROJ-7/auto/outcome-report')
  })

  it('rewrites an existing report in place', () => {
    const prompt = outcomeReportPrompt({ project, existingDoc: 'DOC-12', merged: [] })
    expect(prompt).toContain('PATCH http://localhost:43000/api/docs/DOC-12')
    expect(prompt).not.toContain('POST http://localhost:43000/api/docs with')
  })

  it('caps the commit list', () => {
    const merged = Array.from({ length: 45 }, (_, i) => ({ pr: `PR-${i + 1}`, sha: `sha${i}`, title: '' }))
    const prompt = outcomeReportPrompt({ project, existingDoc: null, merged })
    expect(prompt).toContain('the latest 40 of 45')
    expect(prompt).not.toContain('PR-5 ')
    expect(prompt).toContain('PR-45 ')
  })
})
