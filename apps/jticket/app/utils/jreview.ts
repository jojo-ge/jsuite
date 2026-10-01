// jReview's review shapes, as the project page's Review tab reads them through
// /api/projects/:id/reviews (server side: server/utils/jreview.ts). jReview
// owns the format — apps/jreview/app/utils/reviewTypes.ts.

export type JreviewStatus = 'reviewing' | 'triaging' | 'triaged' | 'ticketed'

/** A triaged finding; `ticketKey` once it was added to a project. */
export interface JreviewFinding {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  file?: string
  line?: number
  summary: string
  detail: string
  reviewers: number[]
  ticketKey?: string
}

/** A list row. */
export interface JreviewMeta {
  key: string
  title: string
  branch: string
  prNumber?: number
  base: string
  status: JreviewStatus
  findingCount: number
  ticketedCount: number
  reviewersDone: number
  reviewerCount: number
  projectKey?: string
  consensus?: boolean
  loop?: number
  createdAt: string
}

export interface JreviewRun {
  key: string
  title: string
  repoPath: string
  branch: string
  base: string
  pr: { number: number; title: string; url: string } | null
  worktree: boolean
  status: JreviewStatus
  project?: string
  consensus?: { projectKey: string; loop?: number; considered?: number; kept?: number }
  reviewers: { n: number; docKey: string; status: 'queued' | 'running' | 'done' | 'failed' | 'skipped'; agent?: string; error?: string }[]
  triage: { docKey: string; status: 'waiting' | 'running' | 'done' | 'failed'; agent?: string; error?: string }
  findings: JreviewFinding[]
  tickets: { projectKey: string; ticketKeys: string[] } | null
  createdAt: string
}
