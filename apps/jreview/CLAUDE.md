# jReview

Multi-reviewer code review. The New review button records a review and
dispatches four Opus 5.5 REVIEWER sessions into herdr (workspace
`jreview · <repo>`, one packed 2×2 tab `review <key>`). Each prompt starts
with the slash command — `/code-review` (or `/jarch-review` on an
architecture pass), always the GLOBAL skill, never one the target repo carries
in its own `.claude/skills` — over `<base>...HEAD`, then `/jreview-report`
publishes the report as a jExplain document at its pre-assigned key
`jreview-<key>-r<n>`. The server-side watcher (`server/plugins/reviewWatcher.ts`)
polls the shared document pool; when every reviewer is settled it
dispatches one TRIAGE session (`/jreview-triage <key>`), which dedupes the
reports, publishes `jreview-<key>-triage`, and POSTs the merged findings to
`/api/reviews/:key/findings`. The human's button then splits them into a new
jTicket project — or, for a review jTicket's project Review tab started
(`review.project`), adds them to that project. See README.md for the flow and API.

Rules that matter here:

- **A document landing IS the completion signal.** Reviewers never call
  jReview; the watcher sees `readDoc(docKey)` return non-null and marks the
  reviewer done. Keep doc keys pre-assigned on the review and the skill
  publishing with `--replace` (otherwise the pool suffixes the key and the
  watcher never sees it).
- **Triage fires from the server, once.** The watcher flips `reviewing →
  triaging` inside `updateReview` (serialised per key) before dispatching, so
  two ticks can't start two triagers. Don't move triage firing into the page.
- **The ticket split is human-only.** `POST /api/reviews/:key/tickets` is
  called by the room's button or jTicket's Review tab (proxying its button);
  no skill or session may call it. The target is `projectKey`, else wherever
  the first batch went, else `review.project`, else a new project (`POST
  /api/projects`). Tickets are imported by project KEY (import resolves
  titles, which could hit an older same-named project). Each finding records
  its `ticketKey`, so already-ticketed findings are skipped and the rest can
  follow later — into the same project only.
- **An agreement review hands back findings, never tickets.** A PR review
  project's review plan asks for `agreement: {loop}` + `project` + `pr` (+
  `verify`, `context.brief`/`checks`): `/jreview-consensus` keeps what every
  reviewer raised, adversarially verifies each (`verify`), judges
  approvability and POSTs `{findings, assessment}` to `/findings` — it is not
  a `consensus` review, so `/consensus` refuses it and the human's ticket
  split still works. Its reviewers run the codebase's own review skill when
  the checkout carries one (`codebaseReviewSkill`, recorded as
  `reviewSkill`), else the global `/code-review`; consensus and arch reviews
  keep the global skills.
- **Posting to GitHub is human-only, and never an approval.** `POST
  /api/reviews/:key/pr-comments` (the room's / jTicket Review tab's Post to PR
  button) sends ONE pull-request review through `gh api` with the human's
  auth; the event is hard-coded `COMMENT` in `server/utils/reviewGithub.ts`
  and is not a parameter. No skill or session may call it, and no session
  may `gh pr review`/`comment` itself. `assessment.verdict` is a
  recommendation only.
- **Every write goes through `updateReview`** — dispatch, the watcher and the
  findings POST touch the same file seconds apart. `writeReview` is
  temp-file + rename so `/watch` never reads a torn file.
- **The app runs no claude.** Sessions are herdr panes via `@jsuite/herdr`;
  a failed dispatch is recorded on the reviewer/triage (`status: failed`,
  `error`) and the room offers retry/skip. Model: `claude-opus-5-5`
  (`JREVIEW_MODEL` overrides).
- Herdr prompts are ONE line — a newline would submit early — and the slash
  command is the FIRST token: claude only runs `/skill` at the start of the
  input; mid-sentence it is just a permission grant. The reviewer prompt is
  built in `server/utils/reviewHerdr.ts` (`reviewerPrompt`); a consensus
  review's `consensus.projectKey` rides along so `/jarch-review` can read the
  project.
- **Sessions run in `review.workdir`, never assume `repoPath`.** A branch
  that isn't checked out gets a detached worktree (`addReviewWorktree`) so
  HEAD is the branch; delete removes it. It goes under the codebase's
  worktree root from its jTicket worktree guide (`GET :43000/api/repos/worktree`),
  else `.data/jreview/worktrees/<key>`, and the reviewer prompt points at the
  guide for any setup. `repoPath` stays the codebase identity (jTicket
  project repo, herdr workspace label). Once a finished review's panes are
  closed the watcher removes that worktree too (`removeReviewWorktree`,
  recorded as `worktreeRemovedAt`), so detached `jreview-*` checkouts don't
  pile up.
- The target defaults to the branch's open PR's `baseRefName` (stacked PRs
  review against their parent), resolved local-first then `origin/`. Every
  ref that reaches a prompt passes `REF_SHAPE` in `reviewGit.ts`.
- Store/util names (`readReview`, `writeReview`, …) must stay distinct from
  the charting/documents auto-imports (`readChart`, `readDoc`, …) — the layers
  share one Nitro auto-import namespace.
