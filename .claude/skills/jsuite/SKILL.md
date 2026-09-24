---
name: jsuite
description: Map of the jSuite local product ecosystem — what jTicket, jDiff, jChart, jExplain, jGrilling, jCode, jMap and jReview each do, how they share data and charts, and which app or skill a request should route to. Use when the user mentions a j-app you need context on, asks which jSuite app fits a task, how the apps relate, or how to start/stop/manage the suite.
---

# jSuite — the local product ecosystem

jSuite is a pnpm-workspace monorepo at `~/code/anyway/jsuite` of eight local
Nuxt apps behind one HTTPS edge. One command starts everything; every app has a
stable URL, so skills and bookmarks point at fixed addresses:

```sh
cd ~/code/anyway/jsuite && ./jsuite start    # apps + Caddy edge
./jsuite status | stop | restart | logs [app] | open [app]
```

| App | URL | Port | What it is |
| --- | --- | --- | --- |
| index | https://jsuite.local | — | static ecosystem page (no process) |
| jTicket | https://jticket.local | 43000 | projects / tickets / docs tracker |
| jDiff | https://jdiff.local | 43002 | local PR & branch diff reviewer |
| jChart | https://jchart.local | 43003 | editable, annotatable Excalidraw diagrams |
| jExplain | https://jexplain.local | 43004 | blog-style explainers with live charts |
| jGrilling | https://jgrilling.local | 43005 | one escalated grilling question, argued in the browser — grillings themselves run in the terminal |
| jCode | https://jcode.local | 43006 | hand-code the part that matters as a standalone problem — Claude ships the feature, then poses its core as a sandbox kata: brief → hints → answer, marked in herdr |
| jMap | https://jmap.local | 43007 | codebase cartographer — domains, herdr mapper fleet, interactive map |
| jReview | https://jreview.local | 43008 | four herdr reviewers run the global `/code-review`, a triager dedupes, you split the findings into jTicket tickets (or, for jTicket's auto loop, 2 reviewers + a consensus session file only agreed findings) |

Always include the scheme and port: `https://<app>.local`. Plain HTTP on
that port returns a 400, not a redirect.

## The products

**jTicket** — the planning hub. A lean local tracker (projects, tickets
with acceptance criteria and blocked-by edges) plus draft docs. Every ticket
has a main `type` — `story` · `task` · `bug` · `review` · `verification` ·
`research` · `decision` · `docs` — and exactly one agency tag in its labels,
`afk` or `hitl` (HITL gets its own herdr tab); an optional `prototype` tag marks
throwaway work that must never ship. A doc is a
tracker record wrapping a **shared block document** (the jExplain format, one
pool for both apps); descriptions and resolutions are plain GFM markdown.
It is deliberately NOT Jira/Confluence: skills author breakdowns and documents
here *locally first* for human review. It also carries **local pull requests** —
GitHub for the local repo: a ticket branch squash-merged onto the project's
integration branch by jTicket itself (`POST /api/prs`, merge button in the UI;
no push, no diffs — jDiff renders those; only the integration branch ever syncs
to origin). It can also **sync a project between two machines** (jTicket
sync): the project page's Share panel makes a 2-hour capability link the
coworker imports; from then on either side pulls a snapshot of the peer's
half, and **the serving human approves every pull in their UI** before any
data moves. Frames travel over Supabase Realtime Broadcast, sealed end-to-end
with the share's room secret, so the relay carries ciphertext it cannot read
(one-time setup via `packages/relay/wizard.sh`; both machines wire the same
free Supabase project). Peer-owned tickets/docs are read-only
and never dispatchable, and peer-authored text is wrapped in
untrusted-content framing before it enters any prompt. Drive it via its HTTP
API on :43000 — never edit its JSON directly. Skills: `to-jticket` (break down work, CRUD
anything, query the board), `to-jspec` (write a spec as a doc — block format),
`to-jdoc` (draft a doc page locally), `jwayfinder` (map work too big for one
session as investigation tickets), `jimplement` (claim a ticket, build it,
record the outcome). It also hosts **architect-mode projects** — the projects
page's Improve-architecture button (or `POST /api/projects/architect`) scans
the selected codebase for deepening opportunities: `/jarchitect-scan` fills
the board with graded HITL `decision` candidate tickets (`arch:strong` /
`arch:worth-exploring` / `arch:speculative`, one `arch:top-pick`) plus an
assessment spec with before/after jChart diagrams; a candidate's herdr button
dispatches its go/no-go grilling (`/jarchitect-grill`, answered in its herdr pane)
and finishes the ticket — the grilling hardens it into an
implementation-ready spec doc.
It also hosts **predeploy-mode projects** — a board of suspected bugs standing
between a codebase and a deploy, one report per ticket. A ticket's herdr button
dispatches `/jreproduce`: it reproduces the bug in a throwaway git worktree as a
failing test, records that test plus a verdict (`reproduced` / `flaky` /
`not-reproduced` / `already-fixed` / `invalid`) and a blocks-the-deploy call on
the ticket, then tears the worktree down. It never fixes anything — the
resolution is the hand-off to `/jimplement`.
Each codebase has **codebase settings** (`/codebase`): its hand-off prompt
overrides (ticket → project → codebase → global → built-in) and its **worktree
guide** — how that codebase creates, sets up, runs and tears down worktrees,
written by an agent the Worktrees kickoff dispatches into herdr (it asks the
repo, asks the human for what the repo can't say, proves the recipe, then PUTs
`/api/repos/worktree?repo=`). Anything that makes a worktree — `/jimplement`,
`/jreproduce`, jReview — reads that guide first. An integration branch's
Connect worktree button dispatches an agent that checks the branch out the
guide's way and records the link (`/api/projects/:id/worktree`).
A standard project's **jButton** turns on **auto mode**: the jTicket server
itself loops implement → merge → review → fix → merge. Each loop dispatches the
AFK frontier into herdr on Opus 5.5 (`/jimplement`, local PRs), waits for every
ticket, runs the merge sweep on Sonnet 5, asks jReview for a 2-reviewer
**consensus review** of that loop's diff (its Sonnet 5 `/jreview-consensus`
session files only the findings both reviewers raised as AFK tickets straight
into the project), implements those, merges again, then starts the next loop.
HITL tickets are never auto-dispatched — with only HITL work left the loop
waits on you. "Stop at the end of next loop" lets the loop in progress finish.
State: `project.auto` (`POST /api/projects/:id/auto`); engine
`server/plugins/autoLoop.ts`.

**jDiff** — a local GitHub client that's really good at diffs. `gh` lists open
PRs; `git` fetches and diffs locally. Reviews local branches before any PR
exists, stores draft comments in `.data/jdiff/`, and can open the PR and post
them in one shot. Drive it with the `jdiff` CLI: `jdiff pr 123`,
`jdiff branch my-feature`, `--print` for a machine-readable URL. No skill — the
CLI is the interface.

**jChart** — diagram workbench. Claude POSTs mermaid to `/api/charts`; the app
lays it out as an Excalidraw scene; the human redraws freehand and pins notes to
shapes; Claude reads the scene + notes back off `.data/jchart/`. After first
import the canvas is the source of truth, not the mermaid. Skill: `j-chart`.

**jExplain** — blog-style articles built from typed blocks (prose, code, diffs,
charts, callouts) with a glossary and per-block notes. Its block format IS the
suite's document system (`@jsuite/documents`) — jTicket docs live in the same
pool and render here too. Its charts ARE jChart objects — same pool, editable
in place, "Open in jChart" for the full workbench. Skill: `j-explain` (author a
JSON payload, publish via `explain.py`, read notes back, revise with
`--replace`; also the block-vocabulary reference for jTicket docs).

**jGrilling** — one grilling question, argued in the browser. A passive
question room: an external Claude session IS the interviewer — it posts the
question over the HTTP API as jspec-format blocks (three phases: the question,
why it needs answering, the candidate answers as tabbed cases) and monitors the
session file in `.data/jgrilling/` until the user's answer lands. The user
answers in the browser (scrollable transcript, sticky answer bar), and the
wrap-up is a verdict, optionally a debrief in the shared document pool
(decision table + a jChart decision-tree chart).

**It never hosts a whole interview.** Matt Pocock's *grilling* interview runs
in the terminal under the plain `grilling` skill — herdr-dispatched HITL
jTickets included, where the human goes to the herdr pane to answer. A room
opens only when the operator escalates one specific question into the browser
mid-grilling: the interviewer posts that one question, waits, then returns to
the terminal. Skill: `j-grilling` (the interviewer's playbook).

**jCode** — hand-code the part that matters, as a standalone problem. A
Claude BUILD session (skill `jcode`) builds and ships a feature as usual,
then takes its core piece — the function where the central decision lives —
expresses it as a pure function, and POSTs a **kata** to jCode: a sandbox
under `.data/jcode/sandbox/<key>/` (the stub the human fills in, the cases
as data, optional types, plus the app's runner for `ts`/`js`/`php`/`py`), the
brief (the contract, the behaviours, never how), a ladder of 2–3 hints, and
its own answer. The human solves it in the sandbox (Open in VS Code, Run
cases from the page with a cases table and their own console output split
from the runner's); *Mark it* dispatches a MARKING session (`jcode-mark`)
into herdr, which runs the cases, judges against the contract and the hidden
reference, and posts a verdict — what's wrong and where to look, never the
fix — unlocking the next hint. Reveal shows the answer to code along.
**Nothing ships from a kata**: the repo already has Claude's version; this
is practice drawn from real work. **Disclosure is enforced on the server**:
the page only receives the rungs reached; the answer is always on file in
`.data/jcode/<key>.json`. jCode runs no claude of its own. Skills: `jcode`
(build side), `jcode-mark` (the marker).

**jMap** — the codebase cartographer, orchestrated entirely through jTicket.
Creating a map creates a **jMap-mode jTicket project** (repo = the mapped
directory) with a scoping ticket; jTicket's herdr Run buttons dispatch every
phase (`/jmap-scope` divides the repo into domains and creates one
`jmap:domain` ticket per part; `/jmap-domain` maps one part and publishes its
walkthrough doc on the project; `/jmap-synthesize` — created from the map
room's Synthesize button — unifies the docs into the graph and POSTs it back
to jMap; no branches, no PRs, docs and the graph are the output). jMap runs no
claude itself: it polls the project for progress and renders the interactive
SVG map (pan/zoom, hover a node to see its dependencies, click for commentary
and the domain's document). Maps live in `.data/jmap/`. Skills: `j-map` (front
door — create a map of the current repo), `jmap-scope`, `jmap-domain` and
`jmap-synthesize` (the ticket contracts).

**jReview** — multi-reviewer code review. Pick a remembered codebase, a
branch (open PRs detected via `gh`) and a target (defaults to the PR's base,
so a stacked PR reviews against its parent; any branch/tag/SHA allowed; a
branch not checked out is reviewed in a detached worktree), and its Run button dispatches
**four Opus 5.5 reviewers** into herdr (one 2×2 tab), each told to run the
global `/code-review` skill (never the target repo's own) — then publish its
report as a jExplain document at a
pre-assigned key (`/jreview-report`). jReview's server-side watcher polls the
shared document pool for those keys; when every reviewer has reported it
dispatches an Opus 5.5 **triager** (`/jreview-triage`), which merges duplicate
findings, publishes a triage document and POSTs the deduplicated findings
back. The reports and findings render in the review room. **Splitting the
findings into tickets is the human's button**, never an agent's: it creates a
new jTicket project (repo = the reviewed repo) with one `review:finding`
ticket per selected finding. A **consensus review** (`POST /api/reviews` with
`reviewers: 2, consensus: {projectKey, loop}` — jTicket's auto loop) skips
triage: once every reviewer is in, a Sonnet 5 `/jreview-consensus` session
files the findings every reviewer raised straight into that project as tickets
and POSTs their keys to `/api/reviews/:key/consensus`. Reviews live in
`.data/jreview/`. Skills: `jreview-report`, `jreview-triage`,
`jreview-consensus` (the dispatched sessions' contracts).

## How they relate

- **One edge**: a Caddy container routes each `.local` name to its native host
  port; OrbStack resolves the names and terminates HTTPS (no certs, no
  /etc/hosts). Apps run natively (jDiff needs host `git`/`gh`/`claude`); only
  Caddy is Dockerised.
- **One state directory**: every app stores state under
  `~/code/anyway/jsuite/.data/<app>/` (gitignored) via `@jsuite/data` — one
  place to read, back up, or wipe.
- **One chart pool**: the `@jsuite/charting` Nuxt layer carries the Excalidraw
  canvas AND `server/api/charts/**` over `.data/jchart/`, so a chart embedded in
  a jExplain article is the same object opened in jChart; edits and notes flow
  both ways.
- **One document pool**: the `@jsuite/documents` Nuxt layer (which extends
  charting) carries the block model, the renderers (`<DocumentArticle>`), and
  `server/api/documents/**` over `.data/jexplain/`, so a jTicket doc is the
  same object jExplain renders — one document system serving both apps, notes
  included.
- **One herdr adapter**: `@jsuite/herdr` (plain ESM package) dispatches whole
  terminal claude sessions into the herdr workspace manager — workspaces, panes
  packed 2×2 per tab, agent start + prompt with the retry dances, model
  overrides via agent args. jTicket dispatches ticket work; jMap dispatches
  domain mappers; jDiff dispatches its review-guidance sessions (the
  `jdiff-review`/`jdiff-ask` skills, pinned to Opus 5); jCode dispatches its
  marking sessions (`jcode-mark`) — no app runs a headless claude of its own.
- **jTicket ↔ jDiff reviews**: jTicket deep-links every branch/PR into jDiff
  (finished tickets and merged local PRs link to their exact squash diff), and
  its Run-review buttons proxy to jDiff's `POST /api/analyze-dispatch` with
  `ticket=`/`project=` context. The dispatched `jdiff-review` session then
  reports its findings back into jTicket: an integration-branch review files
  `review:finding` tickets in the project; a single ticket's branch review
  posts a comment on that ticket.
- **Notes loop everywhere**: jChart and jExplain keep human feedback in
  `<key>.notes.json` sidecars — the human annotates in the browser, Claude reads
  the sidecar and acts on it.
- **Skills are app-owned**: each app keeps its skills in
  `<app>/.claude/skills`; `./jsuite setup` (repo root) installs them all globally.

## Routing a request

| The user wants… | Use |
| --- | --- |
| break a plan/spec into tickets, query or update the board | `to-jticket` |
| write a spec / design doc for review (block document) | `to-jspec` |
| draft a doc page locally on the board | `to-jdoc` |
| plan work too big for one session | `jwayfinder` |
| execute already-ticketed work | `jimplement` |
| a diagram the human can edit and annotate | `j-chart` |
| a rich explainer / walkthrough / post-mortem | `j-explain` |
| review a PR or local branch diff | `jdiff` CLI (`jdiff pr N`, `jdiff branch B`) |
| be grilled about a plan | `grilling` (in the terminal) — `j-grilling` only when the operator asks for a specific question in the browser |
| build a feature and hand-code its core as a problem ("with jcode") | `jcode` — ship as usual, then publish the core as a sandbox kata; the page dispatches `jcode-mark` to mark attempts |
| a thorough multi-reviewer code review of a branch, findings → tickets | jReview (https://jreview.local) — New review; the dispatched sessions run `jreview-report` / `jreview-triage` |
| run a project hands-off: implement the frontier, merge, review, fix, repeat | the project's **jButton** (auto mode) in jTicket — the server drives the loop; `jreview-consensus` files agreed review findings |
| map a codebase / architecture map of a repo | `j-map` (dispatched tickets run `jmap-scope` / `jmap-domain`) |
| find + triage deepening opportunities in a codebase | jTicket's Improve-architecture button (dispatched tickets run `jarchitect-scan` / `jarchitect-grill`) |
| check whether a suspected bug is real before a deploy | a predeploy-mode jTicket project; its tickets dispatch `jreproduce` (failing test + verdict on the ticket, no fix) |
| share/sync a jTicket project with a coworker | the project page's Share panel; one-time relay deploy via `packages/relay/wizard.sh` (both machines wire the same relay URL) |

If an app isn't responding, `cd ~/code/anyway/jsuite && ./jsuite status` then
`./jsuite start` (it refuses ports held by processes it didn't launch — a stale
dev server must be killed first). Logs: `./jsuite logs <app>`.
