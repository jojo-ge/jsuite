// One row of comment mode: a comment flattened to where it sits and what it
// says. Github review threads and local branch drafts both normalise to this
// so the list doesn't care which kind of comment it's reading.
export interface CommentEntry {
  id: string
  path: string
  side: 'LEFT' | 'RIGHT'
  // null when the line the comment hung off is gone from the diff (github
  // calls these outdated): there is nothing left to jump to.
  line: number | null
  body: string
  user: string
  // The github login behind `user`, when there is one — local drafts are
  // yours and have no account to put a face to.
  login: string | null
  createdAt: string
  // Replies beneath the thread root, which the row shows as a count.
  replies: number
}
