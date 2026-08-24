// Review findings — concrete defects the review session found in the diff,
// shared between the server endpoint and the summary-page rendering. Unlike
// the other artifacts (guidance), findings are actionable issues and may be
// reported onward into jTicket by the review session.
export const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

export interface Finding {
  severity: FindingSeverity
  // File path exactly as in the diff (the new path for renames).
  path: string
  // RIGHT-side line number in the head version; null = file-level finding.
  line: number | null
  title: string
  detail: string
}
