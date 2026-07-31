// "Ask yourself": three big-picture questions claude poses to the reviewer
// about a PR — architecture, new patterns, hard-to-reverse decisions. The
// reviewer writes the answers; each answered question can be posted back to
// the PR as a regular (non-inline) comment.
export interface SelfQuestion {
  topic: string
  question: string
  why: string
  answer: string
  postedUrl: string | null
}
