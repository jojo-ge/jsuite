---
name: jsuite
description: Map of the jSuite local product ecosystem — what jTicket, jDiff, jChart, jExplain, jGrilling, jCode, jMap and jReview each do, how they share data, charts and herdr dispatch, and which app, skill or endpoint a request should route to (the same routing table as the repo's CLAUDE.md, for sessions outside it). Use when the user mentions a j-app you need context on, asks which jSuite app fits a task, how the apps relate, how to drive jTicket (the `jt` CLI, auto mode, run plans, Branches, Today), or how to start/stop/manage the suite. API and engine detail lives in reference/api.md.
---

# jSuite — the local product ecosystem

A pnpm-workspace monorepo at `~/code/jsuite`: eight local Nuxt apps behind one
Caddy edge. OrbStack resolves the `.local` names and terminates HTTPS.

```sh
cd ~/code/jsuite && ./jsuite start    # apps + Caddy edge
./jsuite status | stop | restart | logs [app] | open [app] | setup
```

| App | URL | Port | What it is |
| --- | --- | --- | --- |
| index | https://jsuite.local | — | static ecosystem page (no process) |
| jTicket | https://jticket.local | 43000 | projects / tickets / docs / local PRs; the planning and run hub |
| jDiff | https://jdiff.local | 43002 | local PR & branch diff reviewer |
| jChart | https://jchart.local | 43003 | editable, annotatable Excalidraw diagrams |
| jExplain | https://jexplain.local | 43004 | blog-style explainers with live charts |
| jGrilling | https://jgrilling.local | 43005 | one escalated grilling question, argued in the browser |
| jCode | https://jcode.local | 43006 | hand-code a shipped feature's core as a sandbox kata |
| jMap | https://jmap.local | 43007 | codebase cartographer — domains, walkthrough docs, interactive map |
| jReview | https://jreview.local | 43008 | multi-reviewer code review → deduped findings → tickets |

Always include the scheme: `https://<app>.local`. Bare host ports
(43000–43008) work too. Plain HTTP on a `.local` name returns a 400.

## Routing a request

| The user wants… | Use |
| --- | --- |
| break a plan/spec into tickets, query or update the board | `to-jticket` (drives :43000 through the `jt` CLI) |
| write a spec / design doc for review (block document) | `to-jspec` |
| draft a doc page locally on the board | `to-jdoc` |
| plan work too big for one session | `jwayfinder` |
| execute already-ticketed work | `jimplement` (claim, build, local PR, record the outcome) |
| review a PR or local branch diff; a guided tour; dependency chains | `jdiff` CLI (`jdiff pr N`, `jdiff branch B`, `--print`); the UI dispatches `jdiff-review` / `jdiff-ask` / `jdiff-tour` / `jdiff-chains` sessions on Opus 5 |
| a diagram the human can edit and annotate | `j-chart` |
| a rich explainer / walkthrough / post-mortem | `j-explain` |
| be grilled about a plan | `grilling` in the terminal — `j-grilling` only when the operator asks for ONE question in the browser; jGrilling's **Up next** strip lists the HITL grilling frontier from jTicket and starts a ticket in herdr |
| build a feature and hand-code its core ("with jcode") | `jcode` — ship as usual, then publish the core as a kata; the page's Mark-it dispatches `jcode-mark` |
| map a codebase / architecture map of a repo | `j-map` (front door) — a jMap-mode jTicket project whose tickets run `jmap-scope` / `jmap-domain` / `jmap-synthesize` |
| a thorough multi-reviewer review of a branch, findings → tickets | jReview New review (4 Opus 5.5 reviewers on the global `/code-review`; `jreview-report`, `jreview-triage`); from a jTicket project's **Review** tab the findings join that project |
| a few small tasks/decision tickets in ONE session ("run these together") | jTicket board: tick 2+ frontier cards → **One session** — one claude session, tickets in key order, each on its own hand-off; prompt kind `batch` (overridable per project/codebase/global); no claims, budget or subagents; HITL asks in that pane; 409 under auto mode unless every ticket is HITL (`POST /api/projects/:id/herdr-batch`) |
| where a project's integration branch stands vs origin — push, fast-forward pull, roll-up PR | the project's **Branches** tab (`GET …/branch-status?fetch=1`, `POST …/sync` pushes, `POST …/branch-pull` fast-forwards — never merges) |
| what needs me today — HITL waiting, review requests, my PRs' CI, what's building, the TODO inbox | jTicket's **Today** page (`/today`; `GET /api/today/github?repo=`; TODO project via `POST /api/projects/todo`) |
| run a project hands-off: implement → merge → review → fix loops | the project's **jButton** (auto mode; `POST /api/projects/:id/auto`) — see below |
| run exactly one loop, or one loop over ticked tickets | board **Loop frontier / Loop selected** (`{enabled: true, once: true, tickets?: [keys]}`) |
| a hand-built sequence — which tickets go together, who runs each, where merges/reviews/gates sit | the project's **Run setup** tab (run plan, board or graph view) — **Build with Fable** drafts it, **Start plan** runs it; see below |
| see how projects lead into each other and what each delivered | jTicket **Graphs** page (`/graphs`; ids `G-<KEY>`; `GET /api/graphs`, `GET /api/graphs/G-KEY` — a member project key works too) |
| find + triage deepening opportunities in a codebase | jTicket Improve-architecture button (`POST /api/projects/architect`; tickets run `jarchitect-scan` / `jarchitect-grill`) |
| worktrees — how a codebase makes/sets up/tears down worktrees; connect an integration branch to one | Codebase settings (`/codebase`) → Worktrees: kickoff dispatches `worktree:kickoff`, the agent PUTs the guide to `/api/repos/worktree?repo=`; Connect worktree dispatches `worktree:connect` → `POST /api/projects/:id/worktree` (re-checked against `git worktree list`). Every worktree consumer GETs the guide first |
| check whether a suspected bug is real before a deploy | a predeploy-mode jTicket project; its tickets dispatch `jreproduce` (failing test + verdict on the ticket, never a fix) |
| share/sync a jTicket project with a coworker | the project page's Share panel; one-time setup `packages/relay/wizard.sh` |

When a request spans apps ("spec this, then diagram it"), do each part with
that app's own skill rather than improvising one app's job in another.
Endpoints, bodies, 409 rules and state fields: `reference/api.md`.

## The products

**jTicket** — the planning hub. Projects, tickets (acceptance criteria,
blocked-by edges; one `type` — `story` · `task` · `bug` · `review` ·
`verification` · `research` · `decision` · `docs` — and exactly one agency
label, `afk` or `hitl`; optional `prototype` = never ships) and docs that wrap
a **shared block document** (the jExplain format). Deliberately NOT
Jira/Confluence: skills author breakdowns and documents here *locally first*.
Drive it through the **`jt` CLI** (`bin/jt`, installed to `~/.local/bin/jt`
by `./jsuite setup`; `jt help`) over the :43000 API — `jt ls/show/new/set/
comment/branch/projects/project/queue/claim/prs`, plus `jt get|post|patch|put|
delete PATH [JSON|@file.json|-]` for raw calls (body inline, from a file, or
stdin). Never hand-built `curl`, never edit `.data/jticket/jticket.json`.

- **Local PRs** — GitHub for the local repo: a ticket branch squash-merged onto
  the project's integration branch by jTicket (`POST /api/prs`, merge button;
  `POST /api/prs/:id/merge` answers `headWorktree` so the sweep can remove a
  worktree still holding the merged branch). No push, no diffs (jDiff renders
  those); only the integration branch syncs to origin — via the **Branches**
  tab (push, fast-forward pull, roll-up PR; never merges).
- **Today** (`/today`) — HITL tickets waiting, PRs asking for my review, what's
  building (in-progress AFK tickets, running loops), my PRs' CI rolled up via
  `gh`, and the codebase's TODO inbox (`/idea`, `/bug` land there).
- **Auto mode (the jButton)** — the server loops implement → merge → review →
  fix → merge (`server/plugins/autoLoop.ts`). Each loop dispatches the AFK
  frontier on Opus 5.5 (`/jimplement`, local PRs) — or, **orchestrated**, one
  Fable 5.1 `/jorchestrate` session per phase working tickets through Opus 5.5
  subagents in pooled worktrees, claiming each via `POST …/auto/claim` (budget
  1–4 in flight, enforced server-side) and spec-checking it before marking it
  done; a stalled orchestrator is replaced — waits for every ticket, runs the
  merge sweep on Sonnet 5 (reports back via `…/auto/merge-report`; an unlandable
  PR pauses the loop), asks jReview for a 2-reviewer **consensus review**
  (Sonnet 5 `/jreview-consensus` files only findings BOTH raised — in-scope, or
  any critical break, as tickets in the project; out-of-scope into a
  `<PROJ-key> follow ups` project; reviewers mark `scope: in|out`), implements
  + merges those, loops again. HITL is never auto-dispatched. Watchdog: a
  session stopped with its ticket open 5m is nudged; 10m later (or gone 1m) the
  ticket is marked done and the rest filed as `auto-loop:carryover` (inherits
  blocks; a second carryover is HITL). Pane cleanup after each phase never
  closes a working/blocked agent, an open ticket's pane or an unlabelled pane.
  With nothing open left, a last Opus 5.5 session writes the ≤500-word
  `outcome` doc (`…/auto/outcome-report`). "Stop at the end of next loop"
  finishes the loop in progress. State `project.auto`.
- **Run setup / run plans** — `project.runPlan` (`PUT …/run-plan`; 409 while
  running — **Unlock & stop** / **Stop after this step**). Steps: **implement**
  (each ticket its own `/jimplement` agent, Opus 5.5 high by default, or a
  Fable 5.1 `/jorchestrate` group with its own model/effort and budget;
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
  one Fable 5.1 high `/jrunplan` session (prompt kind `runplan:build`) PUTs the
  plan until `problems` is `[]` and reports via `…/run-plan/built`. Its plans
  keep to one orchestrator at a time and at most 2 tickets in flight (one
  group with budget ≤ 2, or ≤ 2 solo tickets, per implement step).
- **Graphs** (`/graphs`) — cross-project blocked-by edges link projects into
  graphs named "first → last" with each project's status and outcome report.
  Display only; id `G-<KEY>`.
- **Architect-mode projects** (`/jarchitect-scan` fills graded HITL `decision`
  candidates + an assessment spec; `/jarchitect-grill` answers go/no-go in a
  herdr pane) and **predeploy-mode projects** (`/jreproduce`: failing test +
  verdict `reproduced`/`flaky`/`not-reproduced`/`already-fixed`/`invalid`, no fix).
- **Codebase settings** (`/codebase`) — prompt overrides (ticket → project →
  codebase → global → built-in) and the **worktree guide**; agents take its
  cheapest fitting form (slim/test-only) and tear down once the PR is open.
- **Share/sync** — pull-only snapshots over Supabase Realtime Broadcast,
  sealed end-to-end; 2-hour capability links; every pull approved in the
  serving side's UI; peer-owned entities read-only, never dispatchable.

Skills: `to-jticket`, `to-jspec`, `to-jdoc`, `jwayfinder`, `jimplement`,
`jorchestrate`, `jarchitect-scan`, `jarchitect-grill`, `jreproduce`,
`jslice-report`, `jrunplan`.

**jDiff** — a local GitHub client that's really good at diffs. `gh` lists
open PRs; `git` fetches and diffs locally; reviews local branches before any PR
exists, stores draft comments in `.data/jdiff/`, opens the PR and posts them in
one shot. CLI: `jdiff pr 123`, `jdiff branch my-feature`, `--print`. Its
buttons dispatch Opus 5 sessions through `@jsuite/herdr`: `jdiff-review`
(`POST /api/analyze-dispatch` — jTicket's Run-review buttons proxy here with
`ticket=`/`project=`, and the session files `review:finding` tickets or a
ticket comment back), `jdiff-ask`, `jdiff-tour` (fine-grained tour) and
`jdiff-chains` (dependency-chain scoping, fanned out per chain). Skills:
`jdiff-review`, `jdiff-ask`, `jdiff-tour`, `jdiff-chains`.

**jChart** — diagram workbench. Claude POSTs mermaid to `/api/charts`; the app
lays it out as an Excalidraw scene; the human redraws and pins notes; Claude
reads scene + notes back off `.data/jchart/`. After first import the canvas is
the source of truth. Skill: `j-chart`.

**jExplain** — articles from typed blocks (prose, code, diffs, charts,
callouts) with a glossary and per-block notes. Its block format IS the suite's
document system (`@jsuite/documents`); its charts ARE jChart objects. Skill:
`j-explain` (author JSON, publish via `explain.py`, `--replace` to revise; also
the block-vocabulary reference for jTicket docs).

**jGrilling** — one grilling question in the browser. An external Claude
session IS the interviewer: it posts the question as jspec blocks (the
question, why it matters, the options as tabbed cases) and watches
`.data/jgrilling/` for the answer. **It never hosts a whole interview** —
grillings run in the terminal under `grilling` (HITL jTickets included). Its
**Up next** strip (`GET /api/upnext`) shows the HITL grilling frontier from
jTicket grouped by project; Start dispatches the ticket into herdr through
jTicket in its own tab. Skill: `j-grilling`.

**jCode** — hand-code the part that matters. A BUILD session (`jcode`) ships
the feature, then POSTs its core as a **kata**: sandbox under
`.data/jcode/sandbox/<key>/` (stub, cases, the app's runner for ts/js/php/py),
brief, 2–3 hints, hidden answer. *Mark it* dispatches `jcode-mark` into herdr
(runs cases, judges, posts a verdict that unlocks the next hint). Disclosure is
server-side (brief → hints → answer); nothing ships from a kata. Skills:
`jcode`, `jcode-mark`.

**jMap** — the cartographer, orchestrated entirely through jTicket. A map is a
jMap-mode jTicket project; jTicket's herdr buttons dispatch every phase
(`/jmap-scope` → one `jmap:domain` ticket per part; `/jmap-domain` publishes a
walkthrough doc; `/jmap-synthesize`, created from the map room's Synthesize
button, POSTs the graph back). jMap runs no claude and dispatches nothing — it
polls progress and renders the interactive SVG map. State `.data/jmap/`.
Skills: `j-map`, `jmap-scope`, `jmap-domain`, `jmap-synthesize`.

**jReview** — multi-reviewer code review. Pick a codebase, branch (open PRs via
`gh`) and target (defaults to the PR's base; a branch not checked out is
reviewed in a detached worktree); Run dispatches **four Opus 5.5 reviewers**
through `@jsuite/herdr` (`server/utils/reviewHerdr.ts`), each on the global
`/code-review` (never the repo's own), publishing via `/jreview-report` at a
pre-assigned doc key. The watcher (`server/plugins/reviewWatcher.ts`) sees every
report land, dispatches the Opus 5.5 triager (`/jreview-triage` → deduped
findings POSTed back; opens the review in the browser), closes the review's
panes (never a busy one) and removes its worktree. **Splitting findings into
tickets is the human's button** (new project, or the originating project when
started from its Review tab). A **consensus review** (`reviewers: 2`,
`consensus: {projectKey, loop}`) skips triage: a Sonnet 5 `/jreview-consensus`
session files only agreed findings (in-scope → the project; out-of-scope →
`<PROJ-key> follow ups`). `pass: 'architecture'` runs one reviewer on
`/jarch-review`. State `.data/jreview/`. Skills: `jreview-report`,
`jreview-triage`, `jreview-consensus`, `jarch-review`.

## How they relate

- **One edge**: Caddy routes each `.local` name to its host port; only Caddy is
  Dockerised, apps run natively (jDiff needs host `git`/`gh`/`claude`).
- **One state directory**: `~/code/jsuite/.data/<app>/` (gitignored) via
  `@jsuite/data` (`appDataDir`/`appDataFile`).
- **One chart pool**: `@jsuite/charting` serves `/api/charts` over
  `.data/jchart/` in every consumer — a chart in a jExplain article is the
  object opened in jChart; edits and notes flow both ways.
- **One document pool**: `@jsuite/documents` (extends charting) serves
  `/api/documents` over `.data/jexplain/` in jTicket, jExplain AND jGrilling —
  a jTicket doc IS a jExplain document.
- **One herdr adapter**: `@jsuite/herdr` (`ensureHerdrWorkspace`,
  `acquirePackedPane`, `startClaudeIn`) dispatches whole terminal claude
  sessions — panes packed 2×2 per tab, model/effort via agent args. Imported
  by **jTicket** (ticket work, loops, batches, merges, worktree prompts,
  slice/outcome reports), **jDiff** (review/ask/tour/chains on Opus 5),
  **jCode** (`jcode-mark`) and **jReview** (reviewers, triage, consensus).
  jMap's phases are dispatched by jTicket; jChart, jExplain and jGrilling
  dispatch nothing. No app runs a headless claude of its own.
- **Notes loop everywhere**: jChart and jExplain keep human feedback in
  `<key>.notes.json` sidecars — annotate in the browser, Claude reads it back.
- **Skills are app-owned** in `<app>/.claude/skills`; `./jsuite setup`
  installs them all globally from `SKILLS_MANIFEST` and shims `jsuite` + `jt`
  into `~/.local/bin`.

If an app isn't responding: `cd ~/code/jsuite && ./jsuite status`, then
`./jsuite start` (it refuses ports held by processes it didn't launch — kill a
stale dev server first). Logs: `./jsuite logs <app>`.
