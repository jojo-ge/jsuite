# jReview

Four reviewers, one triage, tickets on your say-so. Point jReview at a repo
and it runs four independent Opus 5.5 code reviews in herdr, merges their
duplicate findings with a fifth session, and — when you press the button —
splits what's left into a fresh jTicket project.

Runs at https://jreview.local (port 43008) behind the jSuite edge.

## How a review happens

1. **New review** — pick a codebase (remembered in `.data/jreview/repos.json`,
   merged with the repos jTicket knows; or the folder picker), then a branch
   (local, or remote-only as `origin/<name>`; branches with an open PR are
   flagged via `gh pr list`) and a target. The target defaults to the PR's
   base — for a stacked PR its parent branch, so only the branch's own
   commits are reviewed — else origin's default branch; change it to any
   branch, or type a tag/SHA. A branch that isn't checked out is reviewed in a
   detached worktree — where the codebase keeps its worktrees (its jTicket
   worktree guide), else under `.data/jreview/worktrees/<key>` — removed when
   the review is deleted, so your checkout is never touched. jReview records the
   review in `.data/jreview/<key>.json` with four reviewers, each owning a
   pre-assigned document key `jreview-<key>-r<n>`.
2. **Reviewers** — dispatched one after another into herdr (workspace
   `jreview · <repo>`, a 2×2 tab `review <key>`), claude pinned to
   `claude-opus-5-5`. The prompt: *"Run the target codebase's code review
   skill. If it does not exist, run the default code review skill."* plus the
   fixed point, then `/jreview-report …` publishes the report as a jExplain
   document at the reviewer's key.
3. **Watcher** — a Nitro plugin checks the shared document pool every 4s.
   A reviewer's document appearing marks it done. When all four are done (or
   skipped by you), the review flips to `triaging` and the triager is
   dispatched into its own tab.
4. **Triage** — `/jreview-triage <key>` reads the reports, merges duplicates,
   publishes `jreview-<key>-triage`, and POSTs the findings back. The review
   becomes `triaged`.
5. **Tickets** — your button. Untick any findings you don't want, press
   *Split into jTicket project*: a new project (repo = the reviewed repo)
   with one `bug` ticket per finding, tagged `afk` and labelled
   `review:finding`, `severity:<s>`, `category:<c>`.

The room (`/r/<key>`) shows the pipeline live over SSE and renders every
report inline (Findings · Triage report · Reviewer 1–4).

## API

| Route | Method | Notes |
| --- | --- | --- |
| `/api/reviews` | GET | list (meta) |
| `/api/repos` | GET / DELETE | remembered codebases (+ jTicket's); `DELETE ?path=` forgets one |
| `/api/repos/pick` | GET | native macOS folder picker |
| `/api/branches?repo=` | GET | branches, current, default target, open PR per branch |
| `/api/reviews` | POST | `{ repoPath, branch?, base?, title? }` → `{ key, path }`; dispatches reviewers in the background |
| `/api/reviews/:key` | GET / DELETE | the review record; delete keeps docs and tickets |
| `/api/reviews/:key/watch` | GET | SSE mirror of the review file |
| `/api/reviews/:key/reviewers/:n/dispatch` | POST | retry / restart one reviewer |
| `/api/reviews/:key/reviewers/:n/skip` | POST | give up on one reviewer so triage can proceed |
| `/api/reviews/:key/triage/dispatch` | POST | retry / restart the triager |
| `/api/reviews/:key/findings` | POST | the triager's hand-back `{ findings }` → `triaged` |
| `/api/reviews/:key/tickets` | POST | the human's split `{ findingIds? }` → new jTicket project |

Plus `/api/documents/**` and `/api/charts/**` from the shared layers.
