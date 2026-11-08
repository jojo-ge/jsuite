# jSuite — API and engine reference

Detail behind `SKILL.md`. Every path is verified against `apps/*/server/api/**`
(route files) — a path not listed there does not exist. Base URLs:
`https://<app>.local` or `http://localhost:<port>` (jTicket :43000, jDiff
:43002, jChart :43003, jExplain :43004, jGrilling :43005, jCode :43006, jMap
:43007, jReview :43008).

## jTicket — the `jt` CLI

`bin/jt` (repo root; `./jsuite setup` symlinks it to `~/.local/bin/jt`). Base
URL `$JTICKET_URL`, default `http://localhost:43000`. Never hand-build `curl`,
never edit `.data/jticket/jticket.json`.

```
jt ls [projectId= status= assignee= label= frontier=1 repo=]   list tickets (--json for raw)
jt show KEY                       one ticket as JSON
jt new PROJECT "title" [field=value ...]
jt set KEY field=value ...        patch (labels=a,b  blockedBy=T-1,T-2  description=@spec.md)
jt comment KEY "body" [author]    author defaults to $JT_AUTHOR or "claude"
jt branch KEY [branch]            cut / adopt the ticket's work branch
jt projects [repo=...] | jt project KEY
jt queue PROJECT [orchestrator=N]       auto-loop queue as orchestrator N sees it
jt claim PROJECT KEY [orchestrator=N]   orchestrator claim; exit 75 while the budget is full
jt prs [projectId= ticket= status= repo=]
jt get|post|patch|put|delete PATH [JSON|@file.json|-]   raw call; body inline, from a file, or stdin
```

A doc record (`/api/docs/DOC-n`) has no body — its blocks are at
`/api/documents/<documentKey>` (the shared document pool).

## jTicket — routes by job

**Core records**: `/api/projects` (GET/POST; `[id]` GET/PATCH/DELETE; `order` PUT;
`architect` POST makes an architect-mode project; `todo` POST get-or-creates the
codebase's TODO project, idempotent), `/api/tickets` (GET/POST; `[id]`
GET/PATCH/DELETE; `[id]/branch` POST; `[id]/comments` POST, `[commentId]`
DELETE; `[id]/herdr` POST dispatches the ticket into herdr; `[id]/transfer`
+ `accept`/`decline`), `/api/docs` (GET/POST; `[id]` GET/PATCH/DELETE),
`/api/attachments`, `/api/prompts` (GET/PATCH — global prompt overrides),
`/api/repos` (GET/POST/PATCH/DELETE, `pick`, `probe`), `/api/stream` (SSE),
`/api/import`, `/api/projects/import`, `/api/projects/:id/export`.

**Local PRs**: `/api/prs` (GET/POST), `/api/prs/:id` (GET/PATCH/DELETE),
`POST /api/prs/:id/merge` — squash-merges a ticket branch onto the project's
integration branch; the response carries `headWorktree` (a worktree still
holding the merged head branch) so the merge sweep can remove it;
`POST /api/prs/:id/review` proxies to jDiff's dispatch with ticket/project
context. Only the integration branch ever syncs to origin.

**Branches tab** (`server/utils/branchStatus.ts`):
`GET /api/projects/:id/branch-status?fetch=1` — where the integration branch
stands vs origin/default (to push / to pull / roll-up PR);
`POST /api/projects/:id/sync` — plain push (`git push --set-upstream origin
branch:branch`), one-way; `POST /api/projects/:id/branch-pull` — fast-forward
only, never merges; `GET /api/projects/:id/branches`;
`POST /api/projects/:id/integration-branch`; `POST …/integration-pr` (roll-up PR).

**Today page** (`/today`, `app/pages/today.vue`) — what needs me (HITL tickets
not finished and not blocked, PRs asking for my review), what's building
(in-progress AFK tickets, running auto loops), my PRs' CI, and the TODO inbox.
`GET /api/today/github?repo=<codebase path>` reads `gh pr list` in the clone:
`mine` (with `ci: {state, failed, pending, total}` rolled up from
`statusCheckRollup`, `reviewDecision`) and `reviewRequested`; a `gh` failure
returns `error`, not a 500. The TODO inbox is the codebase's todo-mode project
(`POST /api/projects/todo {repo}` — 201 created / 200 existing; `/idea` and
`/bug` land there; a todo's Grill button runs a herdr interview, no branches).

**Graphs**: `GET /api/graphs`, `GET /api/graphs/G-KEY` (a member project key
works too). Logic `app/utils/projectGraphs.ts`.

**Analytics** (passive — nothing is reported by agents): `GET /api/analytics`
(`?repo=` path or slug, `?from=`/`?to=` ISO dates on dispatch time, `?rows=1`
for per-ticket rows) returns the rollup — `summary` (medians: picked up →
closed, → PR, research before first edit, cost; verification share; whole-suite
runs per ticket), `spend` (by role/model), `verification` (by category, top
commands, failed/timed-out/repeated/hidden), `concurrency` (heavy runs in flight
over time + overlap inflation), `weekly`, `league` (per project),
`byModel`/`byMode`/`byType`, `orchestration` (overhead ratio, concurrency,
spec-check lag, idle share). `GET /api/projects/:id/analytics` is the same for
one project with `tickets`, `orchestrations`, `jobs`, `heavyRuns`.
`GET /api/tickets/:id/sessions` is one ticket's row. `POST /api/analytics/backfill
{project?}` / `POST /api/projects/:id/analytics/backfill` match older
transcripts to tickets by first prompt (idempotent). Source of truth: the
session ledger `.data/jticket/sessions.json` (every dispatch passes
`--session-id`, `server/utils/sessions.ts`), `ticket.pickedUpAt`, and the
transcripts under `~/.claude/projects/<cwd-slug>/` (`server/utils/transcripts.ts`
→ `sessionMetrics.ts` → `analytics.ts` / `analyticsRollup.ts`; verification
classification in `verification.ts`, extended per codebase with
`PATCH /api/repos?path= {verificationRules: [{id, category, pattern}]}`; prices
in `pricing.ts`, overridable at `.data/jticket/pricing.json`).

**Worktrees**: `GET/PUT/DELETE /api/repos/worktree?repo=` — the codebase's
worktree guide; `POST /api/repos/worktree/herdr` dispatches the
`worktree:kickoff` prompt. `POST /api/projects/:id/herdr-worktree` dispatches
`worktree:connect` (409 until the codebase has a guide; 400 with no
integration branch); `GET/POST/DELETE /api/projects/:id/worktree` records the
link — POST re-checks the path against `git worktree list` (409 if not a
worktree of the repo, or the repo's own checkout). Every worktree consumer
(`/jimplement`, `/jreproduce`, jReview, the connect prompt, the merge sweep)
GETs the guide first; agents take the guide's cheapest form that fits (slim /
test-only) and tear down once the PR is open; the merge sweep removes any
worktree still holding a merged head branch (`headWorktree`) and deletes the
branch; jReview's watcher removes its reviewer checkouts once a review's panes
close.

**Prompt kinds** (`app/utils/prompts.ts`; resolution ticket → project →
codebase → global → built-in): hand-offs per ticket kind, `batch`,
`worktree:kickoff`, `worktree:connect`, `runplan:build`. Codebase settings
(`/codebase`) hold a codebase's overrides.

**One session (batch)**: `POST /api/projects/:id/herdr-batch {prompt, tickets}`
— one claude session in a `PROJ-n · batch · …` tab works the ticked tickets in
key order, each on its own resolved hand-off (`resolveBatchPrompt`,
`dispatchBatchSession` in `server/utils/herdrDispatch.ts`). No claims, no
budget, no subagents; HITL tickets ask in that pane; 409 under auto mode unless
every ticket is HITL. `POST …/herdr-merge` runs the merge sweep by hand;
`POST …/herdr-cleanup` closes finished panes.

**Reviews from a project**: `GET/POST /api/projects/:id/reviews` (POST → jReview
with `project: KEY`), `GET …/reviews/:key`, `POST …/reviews/:key/action`,
`POST …/reviews/:key/tickets` (adds the picked findings to THIS project; each
finding records its ticket key), `GET …/review-status`, `POST …/review`
(jDiff review of the integration branch).

**Share / sync**: `/api/projects/:id/share` (GET/POST/DELETE), `/api/shares/validate`,
`/api/shares/import`, `/api/sync/channel…`, `/api/sync/pulls` (+ `approve`/`deny`),
`/api/sync/relay`, `/api/projects/:id/pull` (+ `pull/:pullId`). Config
`.data/jticket/sync.json` (`JTICKET_SUPABASE_URL`/`_KEY` override).

## jTicket — auto mode (the jButton), `server/plugins/autoLoop.ts` + `server/utils/autoLoop.ts`

`POST /api/projects/:id/auto` body `{enabled, orchestration?, once?, tickets?,
plan?, continue?}`:
- `{enabled: true}` — start looping. 409 when auto is already on, when the
  project is blocked, or when a `/jrunplan` build is in progress.
- `once: true` — one loop, then off (the board's **Loop frontier**).
  `tickets: [keys]` limits that loop to those keys (**Loop selected**); 409
  unless at least one is an AFK frontier ticket (HITL is never dispatched).
- `plan: true` — walk `project.runPlan` instead of looping (**Start plan**);
  409 with no plan, with `problems`, or with no implement step. A finished
  ticket (done/merged) in a step is not a problem — the engine skips it.
- `plan: true, resume: true` — **Continue plan**: pick the plan up where the
  last run stopped (`project.auto.resume`: the plan it walked, `cursor`,
  `planLog`, `checkpoints`, `lastSliceDoc`; left by Unlock & stop / Stop after
  this step, cleared when a plan runs to its end). The saved plan's steps are
  matched to the stopped run's by id and content (`resumePlanRun`): the leading
  run of unchanged finished steps stay done, the run continues at the next;
  only the steps from there on are validated (`frozen`). 409 with nothing to
  continue, or when every step already ran.
- `continue: true` — pass the gate step in progress (409 when auto is off).
- `enabled: false` — stop; "Stop at the end of next loop" sets `stopRequested`.

Each loop: dispatch the AFK frontier on Opus 5.5 (`/jimplement`, local PRs) —
or, in **orchestrated** mode (`project.auto.orchestration`), one Fable 5.1
`/jorchestrate` session per phase working tickets through Opus 5.5 subagents
in pooled worktrees — wait for every ticket (finished with no PR → look twice
more, 20s apart, then skip the merge) → merge sweep on Sonnet 5, which reports
back via `POST …/auto/merge-report` (a PR it couldn't land pauses the loop) →
2-reviewer consensus review in jReview (`reviewers: 2, consensus: {projectKey,
loop}`) → implement + merge the agreed findings → next loop. With no open
ticket left, a last Opus 5.5 session writes the ≤500-word `outcome`-labelled
doc and reports back via `POST …/auto/outcome-report {doc}`; then auto turns off.

Orchestrator endpoints: `GET …/auto/queue?orchestrator=n` (409 unless an
orchestrated loop is running; `n` is 1-based; other orchestrators' tickets read
`other`, solo tickets `solo`); `POST …/auto/claim {ticket, orchestrator?}` —
the server enforces the budget (1–4 in flight): 409 with `data.wait = true`
while it is full (`jt claim` exits 75), other 409/404 mean not claimable; a
solo ticket's claim is refused. The orchestrator spec-checks each ticket against
its acceptance criteria before marking it done.

Watchdog: a session stopped with its ticket open for 5m is prompted to finish;
still stopped 10m later (or its session gone 1m) the loop marks the ticket done
itself and files the rest as an `auto-loop:carryover` ticket (`Finish KEY: …`)
that inherits the ticket's blocks; a carryover closed the same way is filed
HITL. A stalled or vanished orchestrator is replaced (its in-flight tickets
are re-queued). After every phase-ending step `panesToClean` closes done
tickets' panes, the loop's merge/report panes and past reviews' jReview tabs —
never a working/blocked agent, an open ticket's pane, or an unlabelled pane.

State: `project.auto` — `enabled`, `phase`, `loop`, `orchestration`, `paused
{reason, detail, at}`, `stopRequested`, `once`, `plan`, `cursor`, `planLog`,
`checkpoints`, `lastSliceDoc`, `sliceFrom`, `sliceDispatchedAt`, `slicedAt`.

## jTicket — run plans (Run setup tab)

`project.runPlan`, saved via `PUT /api/projects/:id/run-plan` (logic
`app/utils/runPlan.ts`; graph layout `app/utils/runPlanGraph.ts`,
`RunPlanGraph.vue`). 409 while the plan is running (locked whole — **Unlock &
stop** turns auto off first; the strip's **Stop after this step** finishes the
step) and on a shared project's peer side.

Steps: **implement** (3-step wizard: pick tickets → who runs each → confirm).
Each ticket runs as its own `/jimplement` agent — `--model`/`--effort` from the
step's `dispatch` (Opus 5.5 high by default) or the ticket's `runners[key]` —
unless in an orchestrator group (`step.groups`): then a Fable 5.1
`/jorchestrate` session works that group through subagents on the step's
model/effort or the group's own (`step.groupRunners`), under its own budget.
Solo agents and orchestrators run side by side (`orchestratedKeys` /
`runnerFor`; `effectiveOrchestration()` is what the engine, server and strip
read). HITL tickets are waited on, never dispatched. **merge** sweeps the
plan's open PRs. **review** from a checkpoint (plan start, the previous review,
or any earlier step): optionally an architectural & technical pass first
(`step.review.arch`; jReview `pass: 'architecture'`, one reviewer on the global
`/jarch-review` skill; its `architecture` findings become mandatory fix
tickets, `technical` ones advisory HITL tickets) — phases `arch-reviewing` →
`arch-fixing` → `arch-merging` — then the 2–4 reviewer consensus review
(`step.review.model`/`effort`, Opus 5.5 medium by default; jReview gets
`context.review` = the arch review so its reviewers read it first), whose
agreed findings are fixed and merged inside the step. **gate** waits for
`{continue: true}`.

Slice reports: before every implement step after the plan's first, when the
tip moved since the last one, the engine enters `slice-reporting` — one
Opus 5.5 medium `/jslice-report` session (`server/utils/sliceReport.ts`)
writes a facts-only ≤300-word `slice`-labelled doc and reports back via
`POST …/auto/slice-report {doc}` (409 when none is awaited); every hand-off,
claim prompt and review of that step opens with "read DOC-n first"
(`auto.lastSliceDoc`, recorded on the step as `sliceDoc`); the outcome report
synthesises the slice docs.

Strict ordering: a ticket's open blockers must each sit in an earlier
implement step with a merge between (`runPlanProblems`).

**Build with Fable**: `POST /api/projects/:id/run-plan/build` (`DELETE`
cancels) dispatches one Fable 5.1 high `/jrunplan` session (prompt kind
`runplan:build`) that reads the project, docs, open tickets and code, weighs
each ticket, chooses who runs what on which model/effort, places
merges/reviews/gates sparingly (always a review at the end; HITL tickets in
their own step + gate, or left out), keeps every implement step to one
orchestrator at a time and at most 2 tickets in flight (one group with budget
≤ 2, or ≤ 2 solo tickets), PUTs the plan until `problems` is `[]`,
and reports back via `POST …/run-plan/built`. `project.runPlanBuild` marks it
in progress; the tab is read-only meanwhile.

## jReview (:43008)

`GET/POST /api/reviews` — POST body: codebase, branch, target (defaults to the
PR's base), optional `project: KEY`, `reviewers` (4 by default; 2 for
consensus), `consensus: {projectKey, loop}`, `pass: 'architecture'`,
`context.review`. `GET/DELETE /api/reviews/:key`, `GET …/watch` (SSE),
`POST …/reviewers/:n/dispatch` / `skip`, `POST …/triage/dispatch`,
`POST …/findings` (the triager's hand-back), `POST …/consensus` (the
consensus session's ticket keys), `POST …/tickets` (the human's split into a
new jTicket project). `GET /api/branches`, `/api/repos` (GET/DELETE, `pick`).
Models: reviewers `claude-opus-5-5` (`JREVIEW_MODEL`), consensus
`claude-sonnet-5` (`JREVIEW_CONSENSUS_MODEL`). Watcher
`server/plugins/reviewWatcher.ts`: polls the document pool for the
pre-assigned report keys, dispatches triage/consensus when every reviewer is
in, closes the review's herdr panes once the hand-back lands (never a busy
one), removes the review's worktree. Dispatch: `server/utils/reviewHerdr.ts`.

## jDiff (:43002)

Dispatch (all through `@jsuite/herdr`, model `claude-opus-5`,
`server/utils/herdrReview.ts`): `POST /api/analyze-dispatch` (`/jdiff-review`;
jTicket proxies here with `ticket=`/`project=`), `POST /api/ask-dispatch`
(`/jdiff-ask`), `POST /api/tour-dispatch` (`mode: 'detail'` → `/jdiff-tour`;
`mode: 'chains'` → `/jdiff-chains stage=scope`, fanned out per chain by
`server/utils/chainFanout.ts`). Hand-backs: `POST /api/review-artifact`,
`/api/review-complete`, `/api/ask-result`. Reads: `/api/prs`, `/api/pr`,
`/api/branches`, `/api/diff`, `/api/file`, `/api/findings`, `/api/graph`,
`/api/chains`, `/api/tour`, `/api/risk`, `/api/rating`, `/api/comments`,
`/api/branch-comments`, `/api/notifications`, `/api/asks`, `/api/ai-jobs`.
Writes: `/api/comment`, `/api/branch-comment(-delete)`, `/api/branch-create-pr`,
`/api/open`, `/api/ai-job-cancel`. State `.data/jdiff/`.

## jGrilling (:43005)

`GET/POST /api/sessions`, `GET/DELETE /api/sessions/:key`, `POST …/questions`
(the interviewer posts jspec-format blocks), `POST …/answer`, `POST …/finish`,
`GET …/watch`. **Up next** strip: `GET /api/upnext` — the HITL grilling
frontier read from jTicket, grouped by project (`available: false` = jTicket
unreachable, shown as no strip); `POST /api/upnext/:id/start` dispatches that
ticket through jTicket's `POST /api/tickets/:id/herdr` in its own tab
(`/jwayfinder KEY` for wayfinder projects, else `/jimplement KEY`, told to run
`/grilling` in the terminal and escalate single questions with `/j-grilling`).
State `.data/jgrilling/`.

## jCode (:43006)

`GET/POST /api/katas`, `GET/DELETE /api/katas/:key`, `GET …/full` (answer
included — for the marker), `GET …/files`, `GET …/run`, `GET …/watch`,
`POST …/open` (VS Code), `POST …/hint`, `POST …/reveal`, `POST …/attempts`,
`POST …/attempts/:id/dispatch` (Mark it → `/jcode-mark` into herdr via
`server/utils/kataHerdr.ts`), `POST …/attempts/:id/mark` (the verdict).
Sandbox `.data/jcode/sandbox/<key>/`, record `.data/jcode/<key>.json`.

## jMap (:43007)

`GET/POST /api/maps`, `GET/DELETE /api/maps/:key`, `GET …/progress` (polls the
jTicket project), `POST …/synthesize-ticket` (creates the `/jmap-synthesize`
ticket in jTicket), `POST …/synthesis` (the graph posted back). jMap runs no
claude and dispatches nothing — jTicket's herdr buttons dispatch every phase.
State `.data/jmap/`.

## Shared packages

- `@jsuite/charting` — Nuxt layer: Excalidraw canvas + `server/api/charts/**`
  over `.data/jchart/`.
- `@jsuite/documents` — Nuxt layer (extends charting): block model,
  `<DocumentArticle>`, `server/api/documents/**` over `.data/jexplain/`; in
  jTicket, jExplain and jGrilling.
- `@jsuite/data` — `appDataDir` / `appDataFile` resolve `.data/<app>/`.
- `@jsuite/herdr` — `ensureHerdrWorkspace`, `acquirePackedPane`,
  `startClaudeIn`; imported by jTicket, jDiff, jCode and jReview.
- `@jsuite/relay` — `wizard.sh` sync setup + local broadcast relay.
