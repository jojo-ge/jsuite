---
name: jsuite
description: Map of the jSuite local product ecosystem — what jTicket, jDiff, jChart, jExplain, jGrilling and jRig each do, how they share data and charts, and which app or skill a request should route to. Use when the user mentions a j-app you need context on, asks which jSuite app fits a task, how the apps relate, or how to start/stop/manage the suite.
---

# jSuite — the local product ecosystem

jSuite is a pnpm-workspace monorepo at `~/code/anyway/jsuite` of six local Nuxt
apps behind one HTTPS edge. One command starts everything; every app has a
stable URL, so skills and bookmarks point at fixed addresses:

```sh
cd ~/code/anyway/jsuite && ./jsuite start    # apps + Caddy edge
./jsuite status | stop | restart | logs [app] | open [app]
./jsuite history log                                  # every write to .data
./jsuite history restore <rev> jexplain/my-doc.json   # undo one file
```

`.data` is its own git repo, committed on every write, so local state has undo
and a diffable past. Apps re-read from disk each request — a restore needs no
restart.

| App | URL | Port | What it is |
| --- | --- | --- | --- |
| index | https://jsuite.local | — | static ecosystem page (no process) |
| jTicket | https://jticket.local | 43000 | projects / epics / tickets / docs tracker |
| jDiff | https://jdiff.local | 43002 | local PR & branch diff reviewer |
| jChart | https://jchart.local | 43003 | editable, annotatable Excalidraw diagrams |
| jExplain | https://jexplain.local | 43004 | blog-style explainers with live charts |
| jGrilling | https://jgrilling.local | 43005 | browser grilling sessions — claude interrogates a plan |
| jRig | https://jrig.local | 43006 | avatar studio — draw, rig and keyframe 2D characters |

Always include the scheme and port: `https://<app>.local`. Plain HTTP on
that port returns a 400, not a redirect.

## The products

**jTicket** — the planning hub. A lean local tracker (projects, epics, tickets
with acceptance criteria and blocked-by edges) plus draft docs. A doc is a
tracker record wrapping a **shared block document** (the jExplain format, one
pool for both apps); descriptions and resolutions are plain GFM markdown.
It is deliberately NOT Jira/Confluence: skills author breakdowns and documents
here *locally first* for human review. Drive it via its HTTP API on :43000 —
never edit its JSON directly. Skills: `to-jticket` (break down work, CRUD
anything, query the board), `to-jspec` (write a spec as a doc — block format),
`to-jdoc` (draft a doc page locally), `jwayfinder` (map work too big for one
session as investigation tickets), `jimplement` (claim a ticket, build it,
record the outcome).

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

**jGrilling** — get grilled about a plan before building it. The server runs
the user's local `claude` CLI (via `@jsuite/claude`, the runner extracted from
jDiff) to play Matt Pocock's *grilling* interview: one question at a time, each
with a recommended answer, until shared understanding is reached. The user
answers in the browser; with a repo attached claude looks facts up itself. The
wrap-up is a debrief in the shared document pool (decision table + a jChart
decision-tree chart), readable in-app, in jExplain, or in jTicket. Sessions
live in `.data/jgrilling/`. Skill: `j-grilling` (push the current plan into a
session and hand the user the URL).

**jRig** — the avatar studio. Characters are live vector documents drawn over
one fixed skeleton, so every animation clip plays on every character. A
character or clip is AI-legible JSON in `.data/jrig/` (schema-validated;
Claude edits the files, the studio hot-reloads them); the studio has Illustrate
mode (vector tools, palette roles, mirror symmetry) and Animate mode (timeline
keyframing). Build plan: `apps/jrig/docs/PLAN.md`.

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
- **One claude runner**: `@jsuite/claude` (plain ESM package) drives the local
  `claude` CLI headlessly — streamed progress, tool allowlists, timeouts,
  cancellation. jDiff's review tools and jGrilling's interviewer both run on it.
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
| draw / rig / animate an avatar character | jRig — https://jrig.local (companion skill lands with its M9 milestone) |

If an app isn't responding, `cd ~/code/anyway/jsuite && ./jsuite status` then
`./jsuite start` (it refuses ports held by processes it didn't launch — a stale
dev server must be killed first). Logs: `./jsuite logs <app>`.
