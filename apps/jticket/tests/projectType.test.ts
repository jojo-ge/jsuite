import { describe, expect, it } from 'vitest'
import { projectTypeLabel, projectTypeNoun } from '../app/utils/projectType'
import { coerceProjectMode } from '../server/utils/store'
import { autoModeBlocker } from '../server/utils/autoLoop'
import { runPlanBuildBlocker } from '../server/utils/runPlanBuild'

// A project's type is wording over its stored mode: 'standard' reads "Build",
// 'prreview' reads "Review". Nothing stored or sent changed names.
describe('project type wording', () => {
  it('calls a standard project Build and a PR review project Review', () => {
    expect(projectTypeLabel('standard')).toBe('Build')
    expect(projectTypeLabel('prreview')).toBe('Review')
    expect(projectTypeNoun('standard')).toBe('build')
    expect(projectTypeNoun('prreview')).toBe('review')
  })

  it('calls a plan project Plan, and reads its old mode name as plan', () => {
    expect(projectTypeLabel('plan')).toBe('Plan')
    expect(projectTypeNoun('plan')).toBe('plan')
    expect(coerceProjectMode('plan')).toBe('plan')
    expect(coerceProjectMode('wayfinder')).toBe('plan')
  })

  it('keeps the other modes their own names', () => {
    expect(['todo', 'predeploy'].map(projectTypeLabel)).toEqual(['TODO list', 'Predeploy'])
  })

  it('reads a retired architect project as Build', () => {
    expect(coerceProjectMode('architect')).toBe('standard')
    expect(projectTypeLabel('architect')).toBe('Build')
  })

  it('reads an unknown or missing mode as Build, as the store coerces it to standard', () => {
    expect(projectTypeLabel(undefined)).toBe('Build')
    expect(projectTypeLabel('nope')).toBe('Build')
    expect(projectTypeNoun(null)).toBe('build')
  })

  it('is wording only: the type words are not modes the store accepts', () => {
    expect(coerceProjectMode('standard')).toBe('standard')
    expect(coerceProjectMode('prreview')).toBe('prreview')
    expect(coerceProjectMode('build')).toBe('standard')
    expect(coerceProjectMode('review')).toBe('standard')
  })

  it('names the type in the refusals a human reads', () => {
    const review = { key: 'PROJ-9', mode: 'prreview', repo: '~/code/x', integrationBranch: 'jreview/pr-1', share: null } as never
    expect(autoModeBlocker({ projects: [], tickets: [] } as never, review)).toBe('auto mode drives build projects — PROJ-9 is a review project')
    expect(runPlanBuildBlocker(review)).toBe('run plans drive build projects — PROJ-9 is a review project')
  })
})
