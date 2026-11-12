---
name: jsuite
description: Map of jSuite — one local app, jTicket, whose features are the board and local PRs, auto mode and run plans, Today, Graphs, Analytics, documents (/e), charts (/charts), multi-reviewer code review and PR review projects (/reviews), and the Diff tab with guided tours — and which feature, skill or endpoint a request should route to (the same routing table as the repo's CLAUDE.md, for sessions outside it). Use when the user mentions jTicket or a j-feature you need context on (including the retired names jExplain, jChart, jReview, jDiff), asks which part of jSuite fits a task, how to drive jTicket (the `jt` CLI, auto mode, run plans, reviews, the Diff tab, Today), or how to start/stop/manage the suite. API and engine detail lives in reference/api.md.
---

# jSuite — jTicket and its features

A pnpm-workspace monorepo (`jsuite root` prints where it is checked out) of one
local Nuxt app, **jTicket**, behind a Caddy edge. OrbStack resolves the
`.local` names and terminates HTTPS.

```sh
jsuite start    # jTicket + Caddy edge
jsuite status | stop | restart | logs [jticket|edge] | open | setup | sandbox | root
```

| URL | What |
| --- | --- |
| https://jticket.local (:43000) | jTicket |
| https://jsuite.local | static index page (no process) |
| https://jexplain.local, https://jreview.local, https://jchart.local | **redirect-only**: `/e/K` → `/e/K`, `/r/K` → `/reviews/K`, `/c/K` → `/charts/K`; anything else → that feature's index |

Documents, charts, reviews and diffs were once the apps jExplain, jChart,
jReview and jDiff. They are jTicket features now: there is no other app, no
other port, and no `jdiff` CLI. The old hostnames survive only so stored links
keep working — never hand out a new link through them.

Always include the scheme: `https://jticket.local`. The bare port :43000 works
too. Plain HTTP on a `.local` name returns a 400.

## Routing a request

The UI names a project's type, not its mode: a `standard` project reads
**Build** and a `prreview` (PR review) project reads **Review** — so "a build
project" means mode `standard` and "a review project" mode `prreview`. Only
the wording differs: the stored modes, the API and the prompt kinds keep
their names. A **Plan** project is mode `plan`, and a **Plan review** project
mode `planreview`.

| The user wants… | Use |
| --- | --- |
| break a plan/spec into tickets, query or update the board | `to-jticket` (drives :43000 through the `jt` CLI) |
| write a spec, design doc or any page onto the board for review (block document); the format every ticket and project field takes | `to-jdoc` (it absorbed `to-jspec`) |
| plan work too big for one session | `jplan` (a **Plan** project — mode `plan`; called wayfinder / `jwayfinder` before the rename) |
| execute already-ticketed work | `jimplement` (claim, build, local PR, record the outcome) |
| a rich explainer / walkthrough / post-mortem | `j-explain` → read at `https://jticket.local/e/<key>`; every document is listed at `/e` |
| a diagram the human can edit and annotate | `j-chart` → the editor at `https://jticket.local/charts/<key>` |
| be grilled about a plan | `grilling` in the terminal — always; a todo's **Grill** button, and the herdr button on a HITL `decision` ticket of a standard project, dispatch it into its own tab (prompt kinds `todo`, `standard:decision`; no branch, no PR) |
| a thorough multi-reviewer review of a project's branch, findings → tickets | the project's **Review** tab (`POST /api/projects/:id/reviews`): 4 Opus 5.5 reviewers on the global `/code-review` (`jreview-report`), then `jreview-triage`; the human files the picked findings as tickets in that project. The room is `/reviews/<key>` |
| review someone's GitHub PR with several reviewers, findings → post to the PR | the **Reviews** board (`/reviews`): its **Open PRs** list's **Make review project** (makes the project only — the human presses **Start review** on its Review tab), or the create modal's **Review** type (a review project with no PR yet — its page is a picker of the repo's open PRs until one is picked: `POST /api/projects/:id/pr-review {pr}`) → a **PR review project** (mode `prreview`): Start review re-fetches the PR head and runs one agreement review — 2–4 reviewers, then consensus + adversarial verification + approvability + a summary — which files each finding as a record-only ticket on the project; the Review tab's **Post to PR** sends the picked finding tickets, with the summary, as a COMMENT review under your gh auth (never an approval) and **Rerun review** reviews the new head |
| read a diff — integration branch, a local PR, a GitHub PR, two refs — or a guided tour of it | the project's **Diff** tab (`/projects/KEY?tab=diff` — the integration branch against its base, so a stacked build shows only its own work; `&pr=PR-n` / `&gh=N` / `&head=&base=`); **Build tour** dispatches one Opus `/jdiff-tour` session. Tours are for humans, never handed to reviewers |
| a few small tasks/decision tickets in ONE session ("run these together") | jTicket board: tick 2+ frontier cards → **One session** — one claude session, tickets in key order, each on its own hand-off; prompt kind `batch` (overridable per project/codebase/global); no claims, budget or subagents; HITL asks in that pane; 409 under auto mode unless every ticket is HITL (`POST /api/projects/:id/herdr-batch`) |
| a project's integration branch — cut/set it, stack a build on another, sync from upstream, connect a worktree, open the roll-up PR | the **Overview** tab (integration-branch card: base picker, **Sync from upstream** — `POST /api/projects/:id/integration-branch/sync`, a local merge, never a rebase or push — Connect worktree) and the **Pull requests** tab (roll-up PR to the project's base, `POST …/integration-pr`) |
| what needs me today — HITL waiting, review requests, my PRs' CI, what's building, the TODO inbox | jTicket's **Today** page (`/today`; `GET /api/today/github?repo=`; TODO project via `POST /api/projects/todo`) |
| run a project hands-off: implement → merge → review → fix loops | the project's **jButton** (auto mode; `POST /api/projects/:id/auto`) — see below |
| run exactly one loop, or one loop over ticked tickets | board **Loop frontier / Loop selected** (`{enabled: true, once: true, tickets?: [keys]}`) |
| a hand-built sequence — which tickets go together, who runs each, where merges/reviews/gates sit | the project's **Run setup** tab (run plan, board or graph view) — **Build with Fable** drafts it, **Start plan** runs it; see below |
| cut large work into reviewable slices handed plan → builds → reviews; how projects lead into each other; **Move on** to the next one | jTicket **Graphs** (`/graphs` menu, one graph at `/graphs/G-n`): stored, hand-built graphs of plan/build/review nodes (proposed ones have no project yet). `GET /api/graphs?repo=`, `GET /api/graphs/G-n` (a member project key works too); no hard gates — a briefing with warning `flags` before each node, and Move on (`POST /api/graphs/:id/nodes/:nodeId/enter`) always works and starts nothing |
| turn a finished plan into build tickets and a proposed graph | a Plan project's **Ticket plan** tab: **Draft ticket plan** dispatches `jplan-to-jtickets` (spec doc, draft tickets with `plannedFor`, proposed builds and reviews sized as reviewable slices); **Approve** makes the build projects and moves the drafts in (`POST /api/projects/:id/ticket-plan/approve`) |
| review a plan before it is built — spec against the code, missing decisions, builds sized as reviewable slices | a **Plan review** project (mode `planreview`; the create modal's Plan review type, `POST /api/projects {mode: "planreview", plan}`, or Move on into a plan review node): its Review tab's **Start review** (`POST /api/projects/:id/reviews`) runs one agreement review of the plan — no diff — with each reviewer on `jplan-review`; findings are record-only tickets on it. Lives on the Reviews board |
| send review findings back to where they get fixed | the review project's Review tab → **Send back** (`POST /api/projects/:id/findings/send-back {ticketKeys}`): a review after a build in a graph files AFK `bug` tickets on that build; a plan review files HITL `decision` tickets on its plan; then **Rerun review** |
| how long tickets take / what they cost, per ticket, project or across projects; verification time, whole-suite vs filtered runs, orchestrator overhead | project **Analytics** tab (`GET /api/projects/:id/analytics`) and the **Analytics** page (`/analytics`; `GET /api/analytics?repo=&from=&to=&rows=1`) — passive, read off claude transcripts via the session ledger; `POST /api/analytics/backfill {project?}` adds older sessions |
| how a run went and what got in the way — nudges, pauses, forced closes, tool errors, refused API calls, human interventions, which ticket a review finding came from | **harness capture** (no page yet; mechanical, kept in `.data/jticket/harness/`): the run journal `GET /api/harness/journal?project=&run=&kind=`, runs and their snapshots `GET /api/harness/runs` / `GET /api/harness/runs/:id`, session digests with friction `GET /api/harness/sessions?project=&repo=&role=&harness=&full=1`; `POST /api/harness/capture {force?}` freezes what is ready now |
| worktrees — how a codebase makes/sets up/tears down worktrees; connect an integration branch to one | Codebase settings (`/codebase`) → Worktrees: kickoff dispatches `worktree:kickoff`, the agent PUTs the guide to `/api/repos/worktree?repo=`; Connect worktree dispatches `worktree:connect` → `POST /api/projects/:id/worktree` (re-checked against `git worktree list`). Every worktree consumer GETs the guide first |
| check whether a suspected bug is real before a deploy | a predeploy-mode jTicket project; its tickets dispatch `jreproduce` (failing test + verdict on the ticket, never a fix) |
| share/sync a jTicket project with a coworker | the project page's Share panel; one-time setup `packages/relay/wizard.sh` |

When a request spans features ("spec this, then diagram it"), do each part with
that feature's own skill rather than improvising one feature's job in another.
Endpoints, bodies, 409 rules and state fields: `reference/api.md`.

## jTicket

**jTicket** — the planning hub. Projects, tickets (acceptance criteria,
blocked-by edges; one `type` — `story` · `task` · `bug` · `review` ·
`verification` · `research` · `decision` · `docs` — and exactly one agency
label, `afk` or `hitl`; optional `prototype` = never ships) and docs that wrap
a **shared block document** (see Documents below). Deliberately NOT
Jira/Confluence: skills author breakdowns and documents here *locally first*.
Drive it through the **`jt` CLI** (`bin/jt`, installed to `~/.local/bin/jt`
by `./jsuite setup`; `jt help`) over the :43000 API — `jt ls/show/new/set/
comment/branch/projects/project/queue/claim/prs`, plus `jt get|post|patch|put|
delete PATH [JSON|@file.json|-]` for raw calls (body inline, from a file, or
stdin). Never hand-built `curl`, never edit `.data/jticket/jticket.json`.

- **Local PRs** — GitHub for the local repo: a ticket branch squash-merged onto
  the project's integration branch by jTicket (`POST /api/prs`, merge button;
  `POST /api/prs/:id/merge` answers `headWorktree` so the sweep can remove a
  worktree still holding the merged branch). No push; the **Diff** tab renders
  the diff. Only the integration branch reaches origin, through the roll-up PR
  on the **Pull requests** tab (`POST …/integration-pr` pushes, then opens or
  finds the integration → base PR). The Overview tab cuts or sets the
  integration branch and connects its worktree.
- **Stacked builds** — `project.integrationBase` is the branch a build was cut
  from and its roll-up PR targets (`''` = the default branch, else another
  build's integration branch; at most one upstream). A stacked build shows only
  its own work — Diff tab, slice size, Review tab measure from where it meets
  the upstream. **Sync from upstream** merges the base in locally (upstream
  squash-merged → what it merged into becomes the base and the roll-up PR is
  retargeted); a conflict answers `ok: false` with nothing moved.
- **Today** (`/today`) — HITL tickets waiting, PRs asking for my review, what's
  building (in-progress AFK tickets, running loops), my PRs' CI rolled up via
  `gh`, and the codebase's TODO inbox (its todo-mode project).
- **Auto mode (the jButton)** — the server loops implement → merge → review →
  fix → merge (`server/plugins/autoLoop.ts`). Each loop dispatches the AFK
  frontier on Opus 5.5 (`/jimplement`, local PRs) — or, **orchestrated**, one
  Fable 5.2 `/jorchestrate` session per phase working tickets through Opus 5.5
  subagents in pooled worktrees, claiming each via `POST …/auto/claim` (budget
  2–4 in flight, never 1, enforced server-side) and spec-checking it before marking it
  done; a stalled orchestrator is replaced — waits for every ticket, runs the
  merge sweep on Sonnet 5 (reports back via `…/auto/merge-report`; an unlandable
  PR pauses the loop), starts a 2-reviewer **consensus review**
  (Sonnet 5 `/jreview-consensus` files only findings BOTH raised — in-scope, or
  any critical break, as tickets in the project; out-of-scope into a
  `<PROJ-key> follow ups` project; reviewers mark `scope: in|out`), implements
  + merges those, loops again. HITL is never auto-dispatched. Watchdog: a
  session stopped with its ticket open 5m is nudged; 10m later (or gone 1m) the
  ticket is marked done and the rest filed as `auto-loop:carryover` (inherits
  blocks; a second carryover is HITL). Pane cleanup after each phase never
  closes a working/blocked agent, an open ticket's pane or an unlabelled pane;
  a review's tabs are the review watcher's to close.
  With nothing open left, a last Opus 5.5 session writes the ≤500-word
  `outcome` doc (`…/auto/outcome-report`). "Stop at the end of next loop"
  finishes the loop in progress. State `project.auto`.
- **Run setup / run plans** — `project.runPlan` (`PUT …/run-plan`; 409 while
  running — **Unlock & stop** / **Stop after this step**). Steps: **implement**
  (each ticket its own `/jimplement` agent, Opus 5.5 high by default, or a
  Fable 5.2 `/jorchestrate` group with its own model/effort and budget;
  `GET …/auto/queue?orchestrator=n`, a solo ticket's claim is refused),
  **merge**, **review** from a checkpoint (optional `/jarch-review` pass first:
  `arch-reviewing` → `arch-fixing` → `arch-merging`; then a 2–4 reviewer
  consensus review, Opus 5.5 medium by default), **gate** (`{continue: true}`).
  Before every implement step after the first, when the tip moved, a
  `/jslice-report` session writes a ≤300-word `slice` doc (`…/auto/slice-report`)
  that the step's agents read first. Strict ordering: open blockers must sit in
  an earlier implement step with a merge between. **Start plan** =
  `POST …/auto {enabled: true, plan: true}` (409 if auto is on or a build is in
  progress). A run stopped early leaves `project.auto.resume` (where it got
  to); **Continue plan** = `{enabled: true, plan: true, resume: true}` picks the
  saved plan up at that step (matched by step id, so edits since are allowed
  for), keeps the finished steps' records and checkpoints, and validates only
  the steps from there on — finished tickets in a step are never a problem,
  they're skipped. **Build with Fable** = `POST …/run-plan/build` (`DELETE` cancels):
  one Fable 5.2 high `/jrunplan` session (prompt kind `runplan:build`) PUTs the
  plan until `problems` is `[]` and reports via `…/run-plan/built`. Every
  implement step keeps to the **concurrency rule**: at most 4 sessions at
  once (an orchestrator counts as one) — own agents only (4 at once), mixed
  (1 orchestrator + 3 own agents at once), or 2 orchestrators alone with no
  solo ticket; each orchestrator 2 in flight (never 1) and 4+ tickets in its
  group — fewer is a `problems` entry, and a group that has shrunk under 4 by
  step time runs as own agents. A step may hold more tickets
  than that: its ticket list is a **queue** in the builder's order, and the
  engine starts the next own-agent ticket as a session frees. A review's fix
  tickets go out 3 at a time; a merge sweep, review or report that goes
  silent (45 min; reviews 90) pauses the run — Retry step re-runs it.
- **Graphs** (`/graphs`) — how a large piece of work is cut into slices a
  person can review in one sitting and handed along: a stored graph (`G-n`) of
  plan, build and review nodes joined by directed edges, any mix, a project in
  at most one node; a **proposed** node has no project yet. Each node shows its
  project's progress and outcome report, and each build its slice size
  (flagged past 30 files or 800 lines — split it into stacked builds). **No
  hard gates**: before each node is a briefing over all its upstreams (tickets,
  running work, roll-up PRs and CI, review verdicts, the base) whose `flags`
  only warn; **Move on** always works, creates a proposed node's project (a
  Review node gets the build's open roll-up PR attached) and starts nothing.
  The project page shows the graph strip, and the briefing as a banner until
  its node is entered. Machine-local; cross-project blockers make no graph.
- **Ticket plan** (Plan projects' tab) — **Draft ticket plan** runs one Fable
  5.2 `/jplan-to-jtickets` session: the spec as a doc, draft build tickets on
  the plan (`plannedFor` = a proposed build node; record-only, off the
  frontier), and the proposed builds and reviews in the plan's graph.
  **Approve** creates the build projects and moves the drafts in; it starts
  and enters nothing.
- **Send back** — a review project directly after a build in a graph sends
  picked findings back as AFK `bug` tickets on that build; a plan review sends
  them to its plan as HITL `decision` tickets, in a graph or not
  (`ticket.sentBack` records where each went); fix or decide there, then
  Rerun review.
- **Analytics** (`/analytics`, and a project's Analytics tab) — session
  timing and cost per ticket, measured passively: dispatches run claude with
  `--session-id` and log it to `.data/jticket/sessions.json`; the transcript
  under `~/.claude/projects/` is parsed for duration, research → first edit,
  verification runs (category + whole/filtered scope), PR time and token
  cost. Orchestrations are measured whole and per inner ticket. Agents report
  nothing; `POST /api/analytics/backfill` matches older transcripts to tickets.
- **Predeploy-mode projects** (`/jreproduce`: failing test + verdict
  `reproduced`/`flaky`/`not-reproduced`/`already-fixed`/`invalid`, no fix).
- **Codebase settings** (`/codebase`) — prompt overrides (ticket → project →
  codebase → global → built-in) and the **worktree guide**; agents take its
  cheapest fitting form (slim/test-only) and tear down once the PR is open.
- **Share/sync** — pull-only snapshots over Supabase Realtime Broadcast,
  sealed end-to-end; 2-hour capability links; every pull approved in the
  serving side's UI; peer-owned entities read-only, never dispatchable.

- **Documents** — every doc, spec, review report and explainer is a block
  document (the format `j-explain` documents: prose, code, diff, chart, image,
  steps, compare, timeline, takeaway, glossary) in one pool,
  `.data/jexplain/`, served at `/api/documents`. A doc record
  (`/api/docs/DOC-n`) wraps one by its `documentKey`. The reader is
  `/e/<key>` (per-block notes rail, "Copy notes for Claude", tags, **Export
  PDF**), the library `/e` (full-text search, kind chips). Every document is
  published with one tag, its kind; the library lists and searches only
  `explainer`, `research`, `decision`, `spec` and `proposal` — reports and
  review outputs wait for its **Other kinds** switch.
- **Charts** — Claude pushes Mermaid (`j-chart`, `chart.py`); jTicket lays it
  out as an Excalidraw scene; the human redraws and pins shape notes in the
  editor (`/charts/<key>`, list `/charts`); Claude reads scene + notes back off
  `.data/jchart/`. After first import the canvas is the source of truth. A
  chart block in a document IS the chart the editor opens.
- **Reviews** — every review belongs to a project. A project's **Review** tab
  runs **four Opus 5.5 reviewers** (global `/code-review`, never the repo's
  own), each publishing a report document via `/jreview-report` at a
  pre-assigned key; the review watcher (`server/plugins/reviewWatcher.ts`) sees
  every report land, dispatches the Opus 5.5 triager (`/jreview-triage` →
  deduped findings), closes the review's panes (never a busy one) and removes
  its worktree. **Filing findings as tickets is the human's button**, into
  that project. The auto loop's and run plan's **consensus reviews**
  (`reviewers: 2`, `consensus: {projectKey, loop}`) skip triage: a Sonnet 5
  `/jreview-consensus` session files only agreed findings (in-scope → the
  project; out-of-scope → `<PROJ-key> follow ups`); `pass: 'architecture'`
  runs one reviewer on `/jarch-review`. The room `/reviews/<key>` shows any
  review live. State `.data/jreview/`.
- **PR review projects and the Reviews board** — mode `prreview`, one GitHub
  PR, reviewed and never changed. They leave the projects board and Today for
  the **Reviews** board (`/reviews`; one in a graph also appears there as a
  Review node), which also lists the
  codebase's open PRs a page at a time (`GET /api/repos/prs?repo=`; drafts left
  out unless `&drafts=1`). The project's Review tab's **Start review**
  (`POST /api/projects/:id/reviews {reviewers?}`, 2–4) re-fetches the PR head
  and runs an **agreement review**: reviewers
  use the codebase's own review skill when it has one, an Opus 5.5
  `/jreview-consensus` keeps what every reviewer raised, adversarially verifies
  each (`verify`), judges approvability and hands findings + `assessment`
  back; jTicket files each finding as a record-only HITL `bug` ticket
  (`review:finding`; never frontier, never dispatchable; reruns update the
  matching ticket). Post to PR (human-only) posts the picked finding tickets
  as one COMMENT review — never an approval.
- **Plan review projects** — mode `planreview`, one plan project
  (`project.planReview = {planProjectId, runs}`), reviewed before its builds
  run and never changed; on the Reviews board with the PR reviews. Start review
  runs the same agreement review with the plan as its subject (no branch,
  worktree or diff): reviewers run `/jplan-review` in the main checkout over
  the plan's map, resolutions, docs and ticket plan and the code, then
  `/jreview-consensus`; findings are record-only tickets. Refused (409) while
  the plan's ticket plan is being drafted, or for a plan with no ticket plan
  and no docs. One made with no plan picks it on its Review tab
  (`POST /api/projects/:id/plan-review {plan}`).
- **Diff tab and tours** — side-by-side, server-highlighted rows, expandable
  context, full-file view, for the project's own branch or a `?pr=` / `?gh=` /
  `?head=&base=` target. The file list's chips show only some kinds of file
  (source, tests, docs, config, generated, assets) and its order menu sorts by
  path or line churn. **Build tour** dispatches one Opus `/jdiff-tour`
  session that posts its stops back; the floating tour bar walks them
  (`?stop=i` deep links). Tours live in `.data/jdiff/tours.json`.

Skills (all in `apps/jticket/.claude/skills`): `to-jticket`,
`to-jdoc`, `jplan`, `jplan-to-jtickets`, `jimplement`, `jorchestrate`, `jreproduce`, `jslice-report`, `jrunplan`, `j-explain`,
`j-chart`, `jdiff-tour`, `jreview-report`, `jreview-triage`,
`jreview-consensus`, `jarch-review`, `jplan-review`.

## How it fits together

- **One edge**: Caddy routes `jticket.local` to :43000, serves `jsuite.local`
  from `www/`, and answers the redirect-only hosts itself. Only Caddy is
  Dockerised; jTicket runs natively (it needs host `git`/`gh`/`herdr`/`claude`).
- **One state directory**: `$(jsuite root)/.data/` (gitignored) via
  `@jsuite/data` (`appDataDir`/`appDataFile`); the subdirectories keep the
  retired apps' names (`jticket`, `jexplain`, `jchart`, `jreview`, `jdiff`).
  Entity ids are UUIDv7s; keys (`TICK-n`, `PROJ-n`, `G-n`) are what you use. A
  pre-UUID id (`tick_…`) still resolves, through the one-off migration's map
  `.data/jticket/id-migration.json`.
- **One document pool and one chart pool**: `@jsuite/documents` (extends
  `@jsuite/charting`) serves `/api/documents` over `.data/jexplain/` and
  `/api/charts` over `.data/jchart/`.
- **One herdr adapter**: `@jsuite/herdr` (`ensureHerdrWorkspace`,
  `acquirePackedPane`, `startClaudeIn`) dispatches whole terminal claude
  sessions — panes packed 2×2 per tab, model/effort via agent args — for
  everything jTicket runs: ticket work, loops, batches, merges, worktree
  prompts, slice/outcome reports, reviewers, triage and consensus, tours. Nothing runs a headless claude. Every pane
  lives in the herdr session `jticket` (never herdr's default session;
  `HERDR_SESSION` overrides, the sandbox uses `jsuite-sandbox`) — watch it
  with `herdr session attach jticket`.
- **Notes loop**: documents and charts keep human feedback in
  `<key>.notes.json` sidecars — annotate in the browser, Claude reads it back.
- **Skills are jTicket's** in `apps/jticket/.claude/skills` (plus this one at
  the repo root); `./jsuite setup` installs them all globally from
  `SKILLS_MANIFEST`, prunes dangling links, and shims `jsuite` + `jt` into
  `~/.local/bin`.
- **Sandbox**: from a worktree, never `jsuite start|stop|restart|setup`; run
  `./jsuite sandbox` instead (a copy of the live `.data`, engines off, git/gh
  writes and herdr sessions refused outside `--repos`).

If jTicket isn't responding: `jsuite status`, then `jsuite start` (it refuses
a port held by a process it didn't launch — kill a stale dev server first).
Log: `jsuite logs jticket`.
