# jTicket — API and engine reference

Detail behind `SKILL.md`. Every path is verified against
`apps/jticket/server/api/**` and the layers' `packages/{documents,charting}/server/api/**`
(route files) — a path not listed there does not exist. jTicket is the only
app: base URL `https://jticket.local` or `http://localhost:43000`. Nothing
answers on 43001–43008, and the old `jexplain`/`jreview`/`jchart.local` names
only redirect into jTicket.

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
`todo` POST get-or-creates the
codebase's TODO project, idempotent), `/api/tickets` (GET/POST; `[id]`
GET/PATCH/DELETE; `[id]/branch` POST; `[id]/comments` POST, `[commentId]`
DELETE; `[id]/herdr` POST dispatches the ticket into herdr; `[id]/transfer`
+ `accept`/`decline`), `/api/docs` (GET/POST; `[id]` GET/PATCH/DELETE),
`/api/attachments`, `/api/prompts` (GET/PATCH — global prompt overrides),
`/api/repos` (GET/POST/PATCH/DELETE, `pick`, `probe`), `/api/stream` (SSE),
`/api/import`, `/api/projects/import`, `/api/projects/:id/export`.

**Ids**: every entity's `id` is a bare UUIDv7 (`server/utils/ids.ts`); `:id`
takes the id, the key (`TICK-n`, `PROJ-n`, `G-n`) or a pre-UUID id (`tick_…`),
which resolves through `.data/jticket/id-migration.json` (`findByRef`). That
map was written by the one-off `POST /api/admin/migrate-ids {dryRun?}` (copies
`.data` to `.data.backup-ids-<stamp>` first; 409 while auto mode or a run-plan
build is on; a second run answers `noop: true`).

**Local PRs**: `/api/prs` (GET/POST), `/api/prs/:id` (GET/PATCH/DELETE),
`POST /api/prs/:id/merge` — squash-merges a ticket branch onto the project's
integration branch; the response carries `headWorktree` (a worktree still
holding the merged head branch) so the merge sweep can remove it. Only the
integration branch ever reaches origin, through the roll-up PR.

**Integration branch** (the Overview tab's card, `ProjectIntegrationBranch.vue`,
and the Pull requests tab): `POST /api/projects/:id/integration-branch
{branch?, base?}` cuts or sets it, recording `project.integrationBase` (the
branch it was cut from; `''` = the default branch, also settable with
`PATCH /api/projects/:id {integrationBase}`);
`GET /api/projects/:id/branches?q=&fetch=1` feeds the existing-branch
picker; `POST /api/projects/:id/integration-pr` is the roll-up PR — pushes the
branch, then opens or finds the integration → base PR via `gh` (409 when a
stacked base is gone from origin: sync first);
`GET /api/projects/:id/github` is the Pull requests tab's GitHub side (the repo, the integration branch, `integrationBase`/`baseBranch`, the open PRs that belong to the project, each with a Diff tab link).

**Stacking** (`app/utils/stacking.ts`, `server/utils/integrationBase.ts`): a
build may stack on one upstream build's integration branch; it then shows only
its own work — the Diff tab, its slice size and its Review tab measure from
the **slice base**, where its branch meets the upstream's (or, once the
upstream was squash-merged, the merged PR's head). `GET
/api/projects/:id/integration-branch` (`?force=1` re-asks origin and gh;
never fetches, never throws) → `{configured, branch, base, baseBranch,
defaultBranch, stacked, upstreamProject, upstreamPr, baseExists,
upstreamMerged, upstreamWhy, sync, comparedWith, ahead, behind, pushed,
unpushed, slice: {files, additions, deletions} | null, sliceBase, refreshing,
error}`. `POST /api/projects/:id/integration-branch/sync` is **Sync from
upstream**: fetch, then merge (never rebase, never push) — `sync: 'upstream-open'`
merges the upstream branch in; `'upstream-merged'` merges what it merged into
(usually the default branch), records that as the base and retargets the open
roll-up PR (`gh pr edit --base`); `'default'` (not stacked) merges the default
branch. Answers `{ok, case, from, outcome, base, baseChanged, retarget,
upstreamWhy}` (400 without an integration branch); a conflict or a dirty worktree holding the branch is `ok: false`
with nothing moved.

**GitHub reads are cached** (`server/utils/ghCache.ts`, in memory): this
route, `GET /api/repos/prs` and `GET /api/today/github` answer from what was
last read — at once when it is under a minute old (30s for Today), and at once
with `refreshing: true` while a fresher copy is fetched behind the response
when it is older (up to an hour). `fetchedAt` says how old the answer is; ask
again to get the refreshed one, or send `&force=1` to wait for GitHub.

**Diff tab** (`app/components/ProjectDiff.vue`, `server/utils/projectDiff.ts`):
`GET /api/projects/:id/diff` → `{target, files}` — no params: the project's own
branch (integration vs its base — the default branch, or a stacked build's
slice base, with `target.baseLabel` naming the upstream branch; a PR review
project's `jreview/pr-<n>` vs its base); `?pr=PR-n` a local PR (merged → its squash commit vs parent); `?gh=<n>`
a GitHub PR (head fetched into `refs/remotes/jticket/pr-<n>`); `?head=&base=`
any two refs. `GET …/diff/file` is one file's full view. Links are
`/projects/KEY?tab=diff&…` (`diffTabUrl`, `app/utils/diffTarget.ts`); API
fields that link here are named `diffUrl`.

**Tours**: `GET /api/projects/:id/diff/tour` (same target query as `…/diff`;
the target's tour, build state, last failure), `POST` with the target (`{pr}` | `{gh}` | `{head, base?}` | `{}`)
dispatches one Opus `/jdiff-tour` session into its own `PROJ-n · tour …` tab
(attaches to a live build), `DELETE` cancels; the session posts
`POST …/diff/tour/artifact` then `POST …/diff/tour/complete`. Store
`.data/jdiff/tours.json` (keys: GitHub PR number, `branch/<name>`, `PR-n`),
failures in `.data/jdiff/failures.json`. Tours are for humans only — never
handed to reviewers.

**Today page** (`/today`, `app/pages/today.vue`) — what needs me (HITL tickets
not finished and not blocked, PRs asking for my review), what's building
(in-progress AFK tickets, running auto loops), my PRs' CI, and the TODO inbox.
`GET /api/today/github?repo=<codebase path>` reads `gh pr list` in the clone:
`mine` (with `ci: {state, failed, pending, total}` rolled up from
`statusCheckRollup`, `reviewDecision`) and `reviewRequested` — drafts left out
of both unless `&drafts=1`; a `gh` failure returns `error`, not a 500. The TODO inbox is the codebase's todo-mode project
(`POST /api/projects/todo {repo}` — 201 created / 200 existing; a todo's Grill button runs a herdr interview, no branches).

**Graphs** (menu `/graphs`, one graph `/graphs/G-n?node=<nodeId>`; logic `app/utils/graphs.ts`, server
`server/utils/graphs.ts`) — stored in `store.graphs`, machine-local (never
synced). A graph is `{id, key: 'G-n', title, description, repo, nodes, edges}`;
a node is `{id, mode, projectId (null = proposed), title, note, enteredAt,
enteredNote, enteredBriefing, stackOn}`, an edge `{from, to}` (node ids,
acyclic). A project sits in at most one node of one graph; deleting it turns
its node back into a proposed one. `:id` takes the graph's id, its key (any
case), a member project's key, or an old `G-PROJ-n`.
- `GET /api/graphs?repo=` — newest first; each node with its project, ticket
  counts, `running`, `outcomeDoc`, `state` (`proposed` · `waiting` · `ready` ·
  `entered` · `finished`) and `layer`. `GET /api/graphs/:id` adds each build
  node's `slice` (`ok` with files/additions/deletions, `none`, or `unknown`
  while git is slow) and the briefing each node was entered with.
- `POST /api/graphs {title, repo, description?, nodes?, edges?}` → 201
  `{graph, problems}`; `PATCH /api/graphs/:id {title?, description?, repo?}`;
  `DELETE /api/graphs/:id` (projects untouched).
- `PUT /api/graphs/:id {nodes, edges}` — the whole shape, saved as sent (a node
  without a known id is new; entered records are kept) → `{graph, problems:
  [{nodeId, message}]}`: a cycle, a project in two nodes or graphs, a `stackOn`
  that isn't a direct upstream build.
- `POST /api/graphs/:id/nodes` — `{projectId}` or `{mode, title, note?}`, plus
  `after?: [nodeId]` and `stackOn?` → 201 `{node, graph, problems}`.
- `GET /api/graphs/:id/nodes/:nodeId/briefing` (`?stackOn=<nodeId>` or `''`
  previews a base) → `{graph, node, project, upstreams, base, flags, incomplete,
  at}`: each upstream's tickets, running work, roll-up PR (state, CI), review
  verdict and open findings, integration branch behind/unpushed, outcome doc,
  slice size; a build's base and stack options. `flags` (`warning`|`info`) only
  warn — a large slice (over `SLICE_LARGE_FILES` 30 files or
  `SLICE_LARGE_LINES` 800 lines), stacking on one upstream while another is
  unmerged, tickets blocked from outside the graph. `incomplete: true` means a
  GitHub/git read timed out — ask again.
- `POST /api/graphs/:id/nodes/:nodeId/enter {note?, stackOn?}` — **Move on**:
  never refused, starts nothing. Creates a proposed node's project (a Review
  node: a PR review project with the upstream build's open roll-up PR
  attached, else with no PR yet, said in an `info` flag), sets a build's
  `integrationBase` from `stackOn` when it has no integration branch yet,
  stamps `enteredAt` and keeps the briefing → `{graph, node, project, created,
  briefing, flags}`.
- `GET /api/projects/:id/graph` → `{graph, node, upstream, downstream}` (or
  `{graph: null}`) — the project page's strip, and its Move on banner while the
  node isn't entered.

**Ticket plan** (a Plan project's tab, `ProjectTicketPlan.vue`;
`app/utils/ticketPlan.ts`, `server/utils/ticketPlan.ts`). A **draft** is a
ticket on the plan project with `plannedFor` = a build node's id in the plan's
graph (`POST/PATCH /api/tickets` and `/api/import` take it; 400 unless it names
a build node; `null` clears it): off the frontier, record-only. Routes under
`/api/projects/:id/ticket-plan` (409 on a non-plan project):
- `GET` → `{project, graph, planNodeId, drafts, building, builds: [{nodeId,
  title, note, proposed, project, after, reviews, layer, drafts}], reviews,
  unplaced, problems}`.
- `POST …/graph` — get-or-create the plan's graph → `{graph, planNodeId,
  created}` (201 when made).
- `POST …/build` (202 `{agent, paneId, graph}`; 409 without a repo, on a shared
  plan, or while a session is live) / `DELETE …/build` — the **Draft ticket
  plan** button: one Fable 5.2 high `/jplan-to-jtickets` session (prompt kind
  `ticketplan:build`; `JTICKET_TICKETPLAN_MODEL`/`_EFFORT`), marked by
  `project.ticketPlanBuild`. It reports back with `POST …/built {summary?}` →
  `{wasBuilding, summary, plan}`.
- `POST …/approve {nodes?}` → `{approved: [{nodeId, project, created, moved,
  notes}], plan}` — each build node with drafts gets its project and its drafts
  move in (`projectId` ← the build, `plannedFor` ← null; blockers carry over).
  Starts and enters nothing; review nodes stay proposed. 409 shared, drafting,
  in no graph, or nothing to approve.

**Send back** (`app/utils/reviewHandoff.ts`, `server/utils/reviewHandoff.ts`):
`GET /api/projects/:id/findings/send-back` → `{offered, why, graph, target,
candidates, ticketType}` — per `SEND_BACK_RULES` (keyed by review mode). On a
PR review project it is offered only directly after a build in a graph
(`?to=PROJ-n` picks the build when several lead in), and each finding becomes
an AFK `bug` on the build (with its file, line and a link back). On a plan
review project it is offered whenever its plan still exists, graph or not, and
each finding becomes a HITL `decision` on the plan. `POST … {ticketKeys, to?}`
→ `{target, sent: [{key, ticketKey}], already, refused}`, 409 when not offered.
Every new ticket is labelled `review:sent-back`; the finding records it in
`ticket.sentBack {ticketId, ticketKey, projectId, at}`, and one already sent
files nothing new. Starts nothing.

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

**Harness capture** (mechanical — no session reports anything, no model reads
anything; kept under `.data/jticket/harness/` so it outlives claude's 30-day
transcript cleanup). `GET /api/harness/journal` (`?project=`, `?run=`,
`?kind=a,b`, `?from=`/`?to=`) is the **run journal**: one event per change in
an auto-mode run's state — `run-started`/`run-ended`, `loop-started`/
`loop-finished`, `phase`, `step-finished`, `dispatched`, `ticket-stopped`,
`nudged`, `forced`, `orchestrator-dispatched`/`-replaced`/`-nudged`, `paused`/
`resumed` (reason, detail, how long), `gate-passed`, `stop-requested`,
`merge-dispatched`/`merge-reported`, `no-pr-look`, `review-requested`,
`fix-tickets-filed`, `slice-*`, `report-*` — each with `runId`
(`PROJ-n@<start>`), `loop`, `phase`, `step`, `ticket`, `orchestrator`,
`detail`, `data`. Derived in `saveStore` by diffing `project.auto` against the
last save (`app/utils/runJournal.ts`, `server/utils/runJournal.ts`).
`GET /api/harness/runs` (`?project=`, `?repo=`, `?from=`/`?to=`) lists runs
with event counts and their snapshot's totals; `GET /api/harness/runs/:id` is
the **run snapshot** — events, `pauses`, `tickets` (dispatched/stopped/nudged/
forced, PR, `findingsAgainst`, `planned` — the plan's runner and the builder's
`prediction` for it, frozen at `run-started` — and `actualMinutes`), `reviews` (each finding with `introducedBy` —
the ticket whose merged PR git blames for the line; `by: line|file`),
`sessions`, merged `friction`, `totals` — stored once the run has ended and
settled, built live (`live: true`) before that. `GET /api/harness/sessions`
(`?project=`, `?repo=`, `?role=`, `?harness=`, `?from=`/`?to=`; `?full=1` for
whole digests) is the **session digests**: a ledgered session's metrics and
`friction` (`server/utils/friction.ts`: `toolErrors`, `byClass`, `samples`
with the error text, `apiErrors`, `interventions` human/interrupt/nudge,
`reads`, `repeatedCommands`, `slowCalls`, `compactions`), its subagents' too.
`POST /api/harness/capture {force?}` runs the capture pass now
(`server/utils/harnessCapture.ts`; the auto-loop plugin runs it every 10
minutes). Ledger rows carry `harness` / `commit` / `setup` — the harness
version the session ran under (`server/utils/harnessVersion.ts`).

**Worktrees**: `GET/PUT/DELETE /api/repos/worktree?repo=` — the codebase's
worktree guide; `POST /api/repos/worktree/herdr` dispatches the
`worktree:kickoff` prompt. `POST /api/projects/:id/herdr-worktree` dispatches
`worktree:connect` (409 until the codebase has a guide; 400 with no
integration branch); `GET/POST/DELETE /api/projects/:id/worktree` records the
link — POST re-checks the path against `git worktree list` (409 if not a
worktree of the repo, or the repo's own checkout). Every worktree consumer
(`/jimplement`, `/jreproduce`, the review engine, the connect prompt, the
merge sweep) GETs the guide first; agents take the guide's cheapest form that
fits (slim / test-only) and tear down once the PR is open; the merge sweep
removes any worktree still holding a merged head branch (`headWorktree`) and
deletes the branch; the review watcher removes its reviewer checkouts once a
review's panes close.

**Prompt kinds** (`app/utils/prompts.ts`; resolution ticket → project →
codebase → global → built-in): hand-offs per ticket kind, `batch`,
`worktree:kickoff`, `worktree:connect`, `runplan:build`, `ticketplan:build`. Codebase settings
(`/codebase`) hold a codebase's overrides.

**One session (batch)**: `POST /api/projects/:id/herdr-batch {prompt, tickets}`
— one claude session in a `PROJ-n · batch · …` tab works the ticked tickets in
key order, each on its own resolved hand-off (`resolveBatchPrompt`,
`dispatchBatchSession` in `server/utils/herdrDispatch.ts`). No claims, no
budget, no subagents; HITL tickets ask in that pane; 409 under auto mode unless
every ticket is HITL. `POST …/herdr-merge` runs the merge sweep by hand;
`POST …/herdr-cleanup` closes finished panes.

**Reviews from a project** (the Review tab): `GET/POST /api/projects/:id/reviews`
(POST `{branch?, base?, reviewers?}` — branch defaults to the integration
branch, and a stacked build's is reviewed from its slice base; starts a triage review with `project: KEY`; on a PR review
project it takes only `{reviewers?}` (2–4, default 3), re-fetches the PR head
and starts that PR's agreement review, 409 while one is still out; on a plan
review project likewise `{reviewers?}`, starting the plan's agreement review —
below), `GET …/reviews/:key`,
`POST …/reviews/:key/action {action: retry-reviewer|skip-reviewer|retry-triage, n?}`,
`POST …/reviews/:key/tickets` (files the picked findings as tickets in THIS
project; each finding records its ticket key; 409 for an agreement review,
whose findings are already tickets), `POST …/reviews/:key/pr-comments
{ticketKeys, body}` (Post to PR).

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
or, in **orchestrated** mode (`project.auto.orchestration`), one Fable 5.2
`/jorchestrate` session per phase working tickets through Opus 5.5 subagents
in pooled worktrees — wait for every ticket (finished with no PR → look twice
more, 20s apart, then skip the merge) → merge sweep on Sonnet 5, which reports
back via `POST …/auto/merge-report` (a PR it couldn't land pauses the loop) →
2-reviewer consensus review (`reviewers: 2, consensus: {projectKey,
loop}`) → implement + merge the agreed findings → next loop. With no open
ticket left, a last Opus 5.5 session writes the ≤500-word `outcome`-labelled
doc and reports back via `POST …/auto/outcome-report {doc}`; then auto turns off.

Orchestrator endpoints: `GET …/auto/queue?orchestrator=n` (409 unless an
orchestrated loop is running; `n` is 1-based; other orchestrators' tickets read
`other`, solo tickets `solo`); `POST …/auto/claim {ticket, orchestrator?}` —
the server enforces the budget (2–4 in flight, never 1): 409 with `data.wait = true`
while it is full (`jt claim` exits 75), other 409/404 mean not claimable; a
solo ticket's claim is refused. The orchestrator spec-checks each ticket against
its acceptance criteria before marking it done.

Watchdog: a session stopped with its ticket open for 5m is prompted to finish;
still stopped 10m later (or its session gone 1m) the loop marks the ticket done
itself and files the rest as an `auto-loop:carryover` ticket (`Finish KEY: …`)
that inherits the ticket's blocks; a carryover closed the same way is filed
HITL. A stalled or vanished orchestrator is replaced (its in-flight tickets
are re-queued). After every phase-ending step `panesToClean` closes done
tickets' panes and the loop's merge/report panes — never a working/blocked
agent, an open ticket's pane, or an unlabelled pane. A review's tabs (`review
K`, `triage K`) are the review watcher's to close.

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
unless in an orchestrator group (`step.groups`): then a Fable 5.2
`/jorchestrate` session works that group through subagents on the step's
model/effort or the group's own (`step.groupRunners`), under its own budget.
Solo agents and orchestrators run side by side (`orchestratedKeys` /
`runnerFor`; `effectiveOrchestration()` is what the engine, server and strip
read). HITL tickets are waited on, never dispatched. **merge** sweeps the
plan's open PRs. **review** from a checkpoint (plan start, the previous review,
or any earlier step): optionally an architectural & technical pass first
(`step.review.arch`; review `pass: 'architecture'`, one reviewer on the global
`/jarch-review` skill; its `architecture` findings become mandatory fix
tickets, `technical` ones advisory HITL tickets) — phases `arch-reviewing` →
`arch-fixing` → `arch-merging` — then the 2–4 reviewer consensus review
(`step.review.model`/`effort`, Opus 5.5 medium by default; the review gets
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
cancels) dispatches one Fable 5.2 high `/jrunplan` session (prompt kind
`runplan:build`) that reads the project, docs, open tickets and code, weighs
each ticket, chooses who runs what on which model/effort, places
merges/reviews/gates sparingly (always a review at the end; HITL tickets in
their own step + gate, or left out), keeps every implement step to the
concurrency rule — at most 4 sessions at once, an orchestrator counting as one:
own agents only (4 at once), mixed (1 orchestrator + 3), or 2 orchestrators
alone; budget 2 per orchestrator (a 1 is lifted on save) and 4+ tickets in a
group; groups are folded to 2 on save, a solo ticket beside two orchestrators
or a group under 4 tickets is a `problems` entry — orders
each step's ticket list as its dispatch queue (the engine starts the next
own-agent ticket as a session frees), records a prediction per open ticket
(`step.predictions[key]` = `{weight: light|medium|heavy, minutes, risk:
low|medium|high, why}` — what the run is later scored against), PUTs the plan
until `problems` is `[]`, and reports back via `POST …/run-plan/built` (400,
naming the tickets, while an open implement-step ticket has no prediction).
`project.runPlanBuild` marks it in progress; the tab is read-only meanwhile.

## PR review projects and the Reviews board

Mode `prreview` — one GitHub PR, reviewed, never changed (`app/utils/prReview.ts`).
They leave the projects board and Today for the **Reviews** board
(`/reviews`, `app/pages/reviews/index.vue`; one in a graph also appears there
as a Review node, and Move on into a proposed Review node makes one), whose **Open PRs** section reads
`GET /api/repos/prs?repo=` → `{error, viewer, prs, total, nextCursor, fetchedAt,
refreshing}` — one GitHub search, 25 a page (`&limit=`, 50 at most), most
recently updated first: drafts are left out unless `&drafts=1`, `&mine=1` keeps
my PRs, `&reviewing=me|team` those asking me (or me and my teams) for review,
`&cursor=<nextCursor>` is the next page (a `gh` failure is `error`, not a 500) and whose **Make review project** opens the PR's project or
makes one — without `review`, so nothing is dispatched until the human
presses Start review on its Review tab. `POST /api/projects/pr-review {repo, pr, review?, reviewers?}`
get-or-creates it (PR head fetched to the never-pushed `jreview/pr-<n>`) and,
with `review: true`, starts the review → `{project, created, review?: {key,
url}, reviewError?}`. A review project can also be made with no PR yet — the
create modal's **Review** type, `POST /api/projects {mode: "prreview", repo,
title?}` (400 without a git repo): `prReview` is null and its page is only a
picker of the repo's open PRs until `POST /api/projects/:id/pr-review {pr}`
fetches that PR's head onto `jreview/pr-<n>` and attaches it → the project
(nothing is started; a blank title and description become the PR's; 409 once
the project has its PR, or when another project already reviews that one).
`POST /api/projects/:id/reviews {reviewers?}` is Start /
Rerun review (`startPrReview` in `server/utils/prReview.ts`): the head is
re-fetched and one agreement review of the PR's diff starts — 2–4 reviewers
(default 3) on Opus 5.5 high, `verify: true`; 409 while the last one is still
`reviewing`/`triaging` (retry a stuck reviewer with `…/reviews/:key/action`).
State `project.prReview` = `{pr, runs}` — one run per review started (`n`,
`status: running|done|stopped`, `headSha`, `reviewKey`, `verdict?`), settled
when the findings come back or the review is forgotten. Nothing on a PR
review project is dispatched: a ticket added by hand is a record too, and the
review neither runs nor reads it.

The review is an **agreement review**: when its consensus session hands
the verified findings back (`POST /api/reviews/:key/findings`), jTicket files
each as a ticket on the project (`server/utils/reviewTickets.ts`) — a HITL
`bug` labelled `jreview`, `review:finding`, `severity:*`, `category:*`,
`scope:*`, `verdict:*`, with `ticket.finding` holding the structured copy.
Finding tickets are **record-only**: never frontier, every dispatch path
answers 409. A rerun updates the
project's matching open finding ticket instead of filing a duplicate; a
re-POST of the same review withdraws tickets for findings it dropped. **Post
to PR** is `POST /api/projects/:id/reviews/:key/pr-comments {ticketKeys,
body}` (human-only; the old `{findingIds}` body is refused): one GitHub review
via `gh api`, event `COMMENT` always; "posted" is stamped on each ticket
(`finding.postedAt`, label `pr:posted`).

## Plan review projects

Mode `planreview` ("Plan review") — one plan project's spec and ticket plan,
reviewed before its builds run, never changed (`app/utils/planReview.ts`,
`server/utils/planReview.ts`). Record-only like a PR review project, on the
Reviews board beside them, off the projects board and Today. State
`project.planReview` = `{planProjectId ('' = none picked yet), runs}` — one run
per review started (`n`, `status`, `reviewKey`, `verdict?`, `drafts`,
`builds` — the ticket plan's size then, `startedAt`, `endedAt`).
- `POST /api/projects {mode: "planreview", plan, title?, description?}` — the
  create modal's **Plan review** type (its plan picker); `plan` is a plan
  project's key or id (400 without, 404 unknown, 409 not a plan); the repo is
  the plan's. `PATCH /api/projects/:id` refuses a `mode` change into or out of
  `planreview` (400).
- `POST /api/projects/:id/plan-review {plan}` — pick or change the plan (one
  made by a graph node with no plan before it, or whose plan was deleted);
  starts nothing; 409 once it has reviewed another plan that still exists, or
  on the peer side of a share.
- `POST /api/projects/:id/reviews {reviewers?}` — Start / Rerun review
  (`startPlanReview`): 2–4 reviewers (default 3) on Opus 5.5 high, `agreement:
  {loop}`, `verify: true`, `subject: {kind: 'plan', projectKey}` — no branch,
  PR, base, worktree or head sha. 409 while the last review is still out, while
  a session is drafting the plan's ticket plan, for a plan with no repo, or one
  with no ticket plan and no docs; 404 when the plan is gone.
Each reviewer runs `/jplan-review` in the main checkout (never the codebase's
own review skill): it reads the plan through jTicket — map, resolutions, docs
(the spec is the `spec`-labelled one), the ticket plan — and the code read-only,
and publishes its report through `/jreview-report` (plan variant: `BASE: plan
PROJ-n`). The watcher, `/jreview-consensus` (its plan-review section) and the
filing of findings as record-only tickets are the PR review's. Send back files
the picked findings as HITL `decision` tickets on the plan (above). In a graph,
Move on into a proposed plan review node creates the project pointed at the
plan directly before it (else none yet; an existing plan review of that plan
in no graph is linked instead); the briefing before it shows the plan's
drafts, proposed builds, spec doc and drafting in progress, and the briefing
before a build shows an upstream plan review's verdict and open findings.

## Review engine (`/api/reviews`)

Runs inside jTicket's server (`server/utils/reviewActions.ts`,
`reviewStore.ts`, `reviewGit.ts`, `reviewGithub.ts`, `reviewHerdr.ts`). Every
review belongs to a project: `createReview` refuses one without `project` (or a
consensus review's `consensus.projectKey`) naming an existing project (400).
`GET/POST /api/reviews` — POST body: codebase, branch, target (defaults to the
PR's base; a branch not checked out is reviewed in a detached worktree),
`project: KEY`, `reviewers` (4 by default; 2 for consensus), `consensus:
{projectKey, loop}`, `pass: 'architecture'`, `context.review` — or, from a PR
review project, `pr: N`, `agreement: {loop}`, `verify: true`, `context: {brief:
DOC-n, checks: [TICK-n]}` — or, from a plan review project, `subject: {kind:
'plan', projectKey: PROJ-n}` (no branch or target; stored with the plan's
`title`). Returns `{key, path: "/reviews/<key>"}`.
`GET /api/reviews?orphaned=1` lists the reviews no project's Review tab shows
(no project, or a deleted one) — the Reviews board's **Reviews without a
project**. `DELETE /api/reviews/:key` is the room's **Forget** (record and
worktree go; tickets and reports stay).
`GET/DELETE /api/reviews/:key`, `GET …/watch` (SSE), `POST …/findings`
(the triager's or agreement session's hand-back), `POST …/consensus` (the
consensus session's ticket keys). That is all `/api/reviews` serves: every
human action on a review (retry/skip a reviewer, retry triage, file findings
as tickets, Post to PR) goes through the project's routes,
`/api/projects/:id/reviews/:key/{action,tickets,pr-comments}` (above), which
404 a review that isn't the project's. The room page is `/reviews/<key>`
(`/r/<key>` alias) and uses those routes too. Models: reviewers and agreement consensus
`claude-opus-5-5` (`JREVIEW_MODEL`), consensus `claude-sonnet-5`
(`JREVIEW_CONSENSUS_MODEL`). Watcher `server/plugins/reviewWatcher.ts` (off in
a sandbox without `--engines`): polls the document pool for the pre-assigned
report keys, dispatches triage/consensus when every reviewer is in, closes the
review's herdr panes once the hand-back lands (never a busy one), removes the
review's worktree. State `.data/jreview/`.

## Documents and charts

`/api/documents` (GET/POST; `:key` GET/PATCH/DELETE, `:key/notes` GET/PUT,
`:key/media` POST) and `/api/media/:key/:file` over `.data/jexplain/` — the
`@jsuite/documents` layer. Pages: the reader `/e/<key>`, the library `/e`.
A document carries `tags` — one tag, its kind (lowercase kebab-case;
`packages/documents/tags.ts`), separate from a DOC-n's `labels`: POST takes
them, `PATCH /api/documents/:key {tags}` re-tags in place, and
`GET /api/document-tags` is the vocabulary (the kinds in use, with counts).
`GET /api/documents?q=` is a full-text search over titles, tags and block
text. The library lists and searches only `explainer`, `research`,
`decision`, `spec` and `proposal` (`LIBRARY_KINDS`) and untagged documents;
every other kind (`review-output`, `slice-report`, `outcome-report`,
`status-report`, `review-brief`, `reproduction`) waits for its **Other kinds**
switch (`?all=1`). The reader's **Export PDF** is the
browser's print dialog over the document's print styles.
Publish with `j-explain`'s `explain.py` (`$JTICKET_URL` overrides the target).
`/api/charts` (GET/POST; `:key` GET/PUT/DELETE, `:key/notes` GET/PUT) over
`.data/jchart/` — the `@jsuite/charting` layer; POST answers `path:
/charts/<key>`. Pages: `/charts`, the editor `/charts/<key>` (`/c/<key>`
alias). Push with `j-chart`'s `chart.py`.

## Shared packages

- `@jsuite/charting` — Nuxt layer: Excalidraw canvas + `server/api/charts/**`
  over `.data/jchart/`.
- `@jsuite/documents` — Nuxt layer (extends charting): block model,
  `<DocumentArticle>`, `server/api/documents/**` over `.data/jexplain/`;
  extended by jTicket.
- `@jsuite/data` — `appDataDir` / `appDataFile` resolve `.data/<app>/`.
- `@jsuite/herdr` — `ensureHerdrWorkspace`, `acquirePackedPane`,
  `startClaudeIn`; imported by jTicket (`server/utils/herdr.ts` adds the
  sandbox guards).
- `@jsuite/relay` — `wizard.sh` sync setup + local broadcast relay.
