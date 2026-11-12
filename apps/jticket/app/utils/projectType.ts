// What people are shown for a project's `mode` — its type.
//
// The two main types are Build (mode 'standard': tickets that get implemented,
// merged and reviewed) and Review (mode 'prreview': one GitHub pull request
// under review). Plan review (mode 'planreview') reviews one plan project's
// spec and ticket plan before its builds run. Only the wording is here: the stored modes, the API and what
// each mode does keep their names, so nothing on disk or on the wire changed
// when 'standard' started reading "Build" and 'prreview' "Review".
//
// Import-free on purpose (mode is a plain string): the server's refusal
// messages read it too.

const PROJECT_TYPE_LABEL: Record<string, string> = {
  standard: 'Build',
  plan: 'Plan',
  todo: 'TODO list',
  predeploy: 'Predeploy',
  prreview: 'Review',
  planreview: 'Plan review',
}

/** A badge or option label: "Build", "Review", "Plan"… An unknown mode reads as Build, as the store coerces it to 'standard'. */
export function projectTypeLabel(mode: string | null | undefined): string {
  return PROJECT_TYPE_LABEL[mode ?? ''] ?? PROJECT_TYPE_LABEL.standard!
}

const PROJECT_TYPE_NOUN: Record<string, string> = {
  standard: 'build',
  plan: 'plan',
  todo: 'TODO',
  predeploy: 'predeploy',
  prreview: 'review',
  planreview: 'plan review',
}

/** The type mid-sentence: "this is a review project", "auto mode drives build projects". */
export function projectTypeNoun(mode: string | null | undefined): string {
  return PROJECT_TYPE_NOUN[mode ?? ''] ?? PROJECT_TYPE_NOUN.standard!
}
