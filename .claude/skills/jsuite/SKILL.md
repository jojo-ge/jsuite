---
name: jsuite
description: Map of the jSuite local product ecosystem — what jTicket, jDiff, jChart, jExplain, jGrilling and jMap each do, how they share data and charts, and which app or skill a request should route to. Use when the user mentions a j-app you need context on, asks which jSuite app fits a task, how the apps relate, or how to start/stop/manage the suite.
---

# jSuite — the local product ecosystem

jSuite is a pnpm-workspace monorepo at `~/code/anyway/jsuite` of six local
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
| jGrilling | https://jgrilling.local | 43005 | browser grilling sessions — an external claude session interrogates, you answer in the UI |
| jMap | https://jmap.local | 43007 | codebase cartographer — domains, herdr mapper fleet, interactive map |

Always include the scheme and port: `https://<app>.local`. Plain HTTP on
that port returns a 400, not a redirect.

## The products

**jTicket** — the planning hub. A lean local tracker (projects, tickets
with acceptance criteria and blocked-by edges) plus draft docs. A doc is a
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
data moves. Data travels peer-to-peer over WebRTC; a tiny Cloudflare relay
(deployed once via `packages/relay/wizard.sh`, same URL wired on both
machines) ferries only handshake blobs. Peer-owned tickets/docs are read-only
and never dispatchable, and peer-authored text is wrapped in
untrusted-content framing before it enters any prompt. Drive it via its HTTP
API on :43000 — never edit its JSON directly. Skills: `to-jticket` (break down work, CRUD
anything, query the board), `to-jspec` (write a spec as a doc — block format),
`to-jdoc` (draft a doc page locally), `jwayfinder` (map work too big for one
session as investigation tickets), `jimplement` (claim a ticket, build it,
record the outcome). It also hosts **architect-mode projects** — the projects
page's Improve-architecture button (or `POST /api/projects/architect`) scans
the selected codebase for deepening opportunities: `/jarchitect-scan` fills
the board with graded HITL candidate tickets (`arch:strong` /
`arch:worth-exploring` / `arch:speculative`, one `arch:top-pick`) plus an
assessment spec with before/after jChart diagrams; a candidate's herdr button
dispatches its go/no-go grilling (`/jarchitect-grill`, answered in jGrilling)
and finishes the ticket — the grilling hardens it into an
implementation-ready spec doc.

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

**jGrilling** — get grilled about a plan before building it. A passive
question room: an external Claude session (usually in herdr, often working a
HITL jTicket) IS the interviewer — it runs Matt Pocock's *grilling* interview,
posts each question over the HTTP API as jspec-format blocks (one at a time,
each with a recommended answer), and monitors the session file in
`.data/jgrilling/` until the user's answer lands. The user answers in the
browser (scrollable transcript, sticky answer bar). The wrap-up is a debrief
in the shared document pool (decision table + a jChart decision-tree chart),
readable in-app, in jExplain, or in jTicket. Skill: `j-grilling` (the
interviewer's playbook: open a session, post questions, monitor for answers).

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
  `jdiff-review`/`jdiff-ask` skills, pinned to Opus 5) — no app runs a
  headless claude of its own.
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
| be grilled about a plan, answering in a UI | `j-grilling` |
| map a codebase / architecture map of a repo | `j-map` (dispatched tickets run `jmap-scope` / `jmap-domain`) |
| find + triage deepening opportunities in a codebase | jTicket's Improve-architecture button (dispatched tickets run `jarchitect-scan` / `jarchitect-grill`) |
| share/sync a jTicket project with a coworker | the project page's Share panel; one-time relay deploy via `packages/relay/wizard.sh` (both machines wire the same relay URL) |

If an app isn't responding, `cd ~/code/anyway/jsuite && ./jsuite status` then
`./jsuite start` (it refuses ports held by processes it didn't launch — a stale
dev server must be killed first). Logs: `./jsuite logs <app>`.
