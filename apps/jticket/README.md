# jTicket

A lean, local task tracker — **projects** and **tickets** with title,
description, acceptance criteria, and blocked-by edges — plus **docs**, draft
Confluence-style pages. It is **not connected to Jira or Confluence** and has no
relation to them. It exists so LLM skills (e.g. Matt Pocock's `to-tickets`, or the
local `to-jspec`) can author a breakdown or a document *locally first*, for you to
review and edit before you author anything to Jira/Confluence by hand.

Built with Nuxt 4 + Nuxt UI 4. Data lives in a single human-editable JSON file at
`.data/jticket.json`.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:43000
```

`pnpm build && node .output/server/index.mjs` for a production run.

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Board — every project and its tickets, plus docs and the backlog |
| `/next` | **Up next** — the frontier across every project: open, unblocked, unclaimed tickets, each with its `/jimplement` hand-off command |
| `/running` | **Running now** — every in-progress ticket grouped by its project, with a link through to the project |
| `/finished` | **Recently finished** — every done ticket in completion order, newest first, grouped by the day it landed |
| `/projects` · `/projects/PROJ-1` | Project hub and project detail |
| `/docs` · `/docs/DOC-1` | Docs list and a doc's block document |
| `/api-guide` | Full HTTP API reference, live in the app |

## Data model

- **Project** — `{ key: "PROJ-1", title, description, mode, repo, integrationBranch }`. Top-level grouping; contains tickets.
  - `mode`: `standard` (plain tracker) or `wayfinder` (see **Wayfinder mode** below). In a wayfinder project the `description` *is* the map body.
  - `repo` / `integrationBranch`: the optional GitHub link — see **GitHub** below. Both `""` when unset.
- **Ticket** — `{ key: "TICK-1", title, description, acceptanceCriteria[], type, status, projectId, assignee, labels[], resolution, blockedBy[], completedAt }`
  - `projectId`: the parent project; `null` = backlog
  - `type`: `AFK` (agent-runnable) or `HITL` (needs a human)
  - `status`: `todo` · `in_progress` · `done`
  - `assignee`: free-form name of who is working on it — agents self-assign by name; `""` = unassigned. Filter with `GET /api/tickets?assignee=<name>`. In wayfinder terms, the assignee **is** the claim.
  - `labels`: free-form strings. Wayfinder uses `wayfinder:research|prototype|grilling|task` (the ticket sub-type). Filter with `GET /api/tickets?label=<label>`.
  - `resolution`: the answer recorded when the ticket resolves (GFM markdown); `""` until then.
  - `blockedBy`: ids of tickets that must finish first
  - `completedAt`: ISO timestamp of when the ticket last became `done`; `null` while unfinished. **Set by the server on the status change, never by the caller** — PATCHing it is ignored. Re-saving an already-done ticket keeps the original stamp, so fixing a resolution doesn't move it up `/finished`; moving a ticket out of `done` clears it, and moving it back stamps afresh. Tickets finished before the field existed were backfilled from `updatedAt`.
  - GET responses also attach derived booleans **`blocked`**, **`claimed`**, **`frontier`** (never persisted). `frontier` means takeable *here*: on a shared project a ticket the peer owns, or one mid-ownership-transfer, is read-only and undispatchable on this machine, so it never reads as frontier.
Every `description` / `resolution` field is **plain GFM markdown** and is
rendered as such in the UI (via the shared `@jsuite/documents` renderer). Card
summaries are the exception — they show a flattened plain-text preview so the
line clamp stays honest.

- **Known repo** — `{ path, slug, defaultBranch, lastUsedAt }`. Not a tracker
  record: the list of clones jTicket has been pointed at, so setting up the next
  project is a click. See **GitHub** below.

- **Doc** — `{ key: "DOC-1", title, documentKey, projectId, labels[], status }`.
  A tracker record wrapping a **block document** in the shared jSuite document
  system (`@jsuite/documents`; files in the root `.data/jexplain/` pool, which
  jExplain lists and renders too). Shown at the top of the board and at
  `/docs/DOC-1`.
  - Content is authored as **blocks** (prose, callout, code, diff, chart,
    steps, compare, timeline, takeaway + glossary — the jExplain format).
    `POST /api/docs` with `blocks` creates the document; `documentKey` links an
    existing one; `PATCH` with `blocks` rewrites it (notes survive). Full
    reference at **/api-guide** in the running app.
  - `status`: `draft` · `ready`
  - Images: `POST /api/attachments` with `{ name, base64 }` → serve from
    `/attachments/<name>`, reference as `![alt](/attachments/<name>)` in prose.

## HTTP API

See **/api-guide** in the running app. Summary:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | List / create projects |
| GET/PATCH/DELETE | `/api/projects/:id` | Read / update / delete a project (id or key) |
| GET/POST | `/api/tickets` | List (`?projectId=`, `?status=`, `?finished=true`, `?since=`) / create tickets |
| GET/PATCH/DELETE | `/api/tickets/:id` | Read / update / delete a ticket (id or key) |
| POST | `/api/import` | Bulk-create a whole breakdown at once |
| GET/POST | `/api/docs` | List (`?projectId=`, `?status=`, `?label=`) / create docs |
| GET/PATCH/DELETE | `/api/docs/:id` | Read / update / delete a doc (id or key) |
| GET/POST | `/api/attachments` | List / upload attachments for docs |
| GET | `/api/stream` | SSE — one message per store revision (see **Live updates**) |

### Bulk import (recommended for skills)

`POST /api/import` authors an entire breakdown in one call. Reference each ticket's
`project` by **title or key**, and `blockedBy` by ticket **title or key** — generated
ids are resolved for you after everything is created. `projects` is optional.

```bash
curl -s http://localhost:43000/api/import -H 'content-type: application/json' -d '{
  "projects": [{ "title": "Checkout", "description": "Everything payments-related" }],
  "tickets": [
    { "title": "Add cart schema", "description": "Persist a cart.", "type": "AFK",
      "project": "Checkout", "acceptanceCriteria": ["Survives refresh"] },
    { "title": "Cart UI", "description": "Edit quantities.", "type": "AFK",
      "project": "Checkout", "blockedBy": ["Add cart schema"] }
  ]
}'
```

## Live updates

The store is a single JSON file, so `GET /api/stream` just tails it and pushes a
message whenever it changes — a `PATCH` from an agent and a hand edit of
`.data/jticket/jticket.json` are the same event:

```
curl -N http://localhost:43000/api/stream
data: {"kind":"hello","revision":7}
data: {"kind":"change","revision":8}
data: {"kind":"ping"}
```

The message carries no payload — the revision is a change *signal*, not a
cursor, and it resets when the server restarts (so a second `hello` means
"refetch, you may have missed something"). The browser follows this stream and
refetches, which is why an open board keeps up with an agent working through an
project without a refresh. Tickets that moved ring themselves for a few seconds and
raise a toast; the header dot says whether the stream is actually connected.

## GitHub

A project can point at a **local clone** (`repo` — a path, `~` allowed: the same
path jDiff takes as `?repo=`) and own an **integration branch**: an *empty*
branch cut from the repo's default branch that the project's PRs target, and
which lands as one roll-up PR when the project is done. Both are edited on the
project form; nothing here needs a GitHub token — it shells out to the `git` and
`gh` you already have (`gh auth status`).

### Pointing a project at a repo

Three ways in, on the project form: pick one of the **repos you've used before**,
**Browse…** (a native folder dialog, macOS), or type the path. Whatever lands in
the field is checked as you type (`GET /api/repos/probe`) and the form tells you
what it found — `jojo-ge/jsuite · default branch master`, or why the path is no
good.

The remembered list lives in the store (`repos[]`), not in browser storage, so
agents on the HTTP API see it too. A repo is remembered the moment a project
points at it; `GET /api/repos` returns each with its slug, default branch,
whether the path still exists, and which projects use it, and
`DELETE /api/repos?path=…` forgets one (the list only — projects and disk are
untouched).

The project header carries the branch: a **Branch** button while the project has
a repo but no integration branch (one click — same call as below), which becomes
a chip naming the branch and linking to its jDiff review once it exists.

The project page then shows a **Pull requests** section:

- **Cut the branch** — `POST /api/projects/:id/integration-branch` runs
  `git branch <name> origin/<default>` + `git push -u origin <name>` and records
  the name on the project. It is idempotent: a branch that already exists (yours
  or cut by hand) is *adopted*, not re-cut. The default name is
  `proj/<KEY>-<title-slug>`; pass `{ "branch": "...", "base": "..." }` to override.
- **Or adopt one that already exists** — *use an existing branch* opens a search
  over every branch in the repo, local and on origin
  (`GET /api/projects/:id/branches?q=`, matching branch names *and* commit
  subjects, newest tip first; ↻ does a `git fetch --prune` first so a branch a
  teammate pushed a minute ago shows up). Picking one just sets
  `integrationBranch` — nothing is created or pushed. The same search sits
  behind the 🔍 on a project that already has a branch, for repointing it.
- **The PR list** — `GET /api/projects/:id/github` returns the repo's open PRs
  that belong to this project, matched three ways:

  | Match | Meaning |
  | --- | --- |
  | `integration` | the PR whose **head** is the integration branch — the project's roll-up PR, listed first |
  | `base` | the PR **targets** the integration branch |
  | `key` | the PR's head branch or title names one of the project's keys (`PROJ-3`, `TICK-12`) — so work that went straight to the default branch still shows up |

  Every row links to **jDiff** (`https://jdiff.local/pr/N?repo=…`, overridable
  with `JDIFF_URL`) for the local diff review, and to **github.com**.

`gh` is best-effort: without it (offline, not logged in, no GitHub remote) the
branch side still works and the PR list reports why it's empty.

### Local pull requests

GitHub for your local: single-ticket review happens entirely on the machine, and
only the integration branch ever talks to origin. A **local PR** is a store
record (`prs[]`, `PR-n` keys) — title, description, one ticket, head branch,
base branch, lifecycle — over the project's repo; git holds the code, jTicket
holds the story. No diffs here: every row links into jDiff.

The loop, per ticket:

1. **Cut the ticket branch** — `POST /api/tickets/:id/branch` cuts
   `tick/<TICK-n>-<slug>` off the integration branch, **local only**, and records
   it on the ticket (`ticket.branch`). The *Up next* page does this automatically
   when you copy a "Local PR" hand-off prompt, and bakes the branch name into the
   prompt.
2. **Open the PR** — `POST /api/prs { ticket }` (agents) or the *New local PR*
   button. One ticket per PR, one open PR per ticket; the title defaults to
   `<TICK-n> <title>` and the description becomes the squash commit body.
3. **Merge** — the button, or `POST /api/prs/:id/merge`. A **squash** onto the
   integration branch done with plumbing (`merge-tree` → `commit-tree` →
   `update-ref`, git ≥ 2.38): no checkout, your working tree is never touched,
   whatever you're mid-way through. On success the ticket branch is deleted and
   the ticket moves to **`merged`** (a fourth status; `done` and `merged` both
   count as finished everywhere). If the integration branch happens to be checked
   out *clean*, that checkout is fast-forwarded; checked out *dirty* refuses.
4. **Conflicts refuse cleanly** — the repo is left exactly as it was, the PR
   turns `conflicted` with the file list on the row. Rebase the ticket branch
   onto the integration branch, then hit merge again.
5. **Sync** — `POST /api/projects/:id/sync` (the *Sync* button) pushes the
   integration branch to origin: the only remote write in the flow. The
   *Roll-up PR* button (`POST /api/projects/:id/integration-pr`) pushes and then
   opens — or finds — the one real GitHub PR, integration → default branch,
   via `gh`.

The project page's *Pull requests* section shows both lists: **Local pull
requests** (with per-PR commit fold-outs, merge/close buttons) above **On
GitHub** (the read-only `gh pr list` view, usually just the roll-up).

### Herdr dispatch

When the [Herdr](https://herdr.dev) server is running, the prompts on */next*
don't have to go through the clipboard — each row and each "Merge N PRs" button
grows a **herdr** twin that builds the terminal itself over Herdr's socket CLI
(`server/utils/herdr.ts`):

- one Herdr **workspace per project** — label = the project title, cwd = the
  repo (created on first dispatch);
- ticket agents as **panes, packed up to four per tab**, tabs labelled with the
  project key (`PROJ-2`, then `PROJ-2 · 2`, …), each pane running `claude` with
  the same hand-off prompt the copy button would have copied (the ticket branch
  is cut first, exactly like copying);
- merge sweeps as their **own single-pane tab** (`PROJ-2 · merge`), one agent
  working through the PR queue;
- **nothing steals focus** — every create/split passes `--no-focus`. Moving over
  is explicit: the group-header **herdr** button focuses the project's
  workspace, and per-tab chips (with agent-status dots) focus individual tabs
  via `POST /api/herdr/focus`.

All of it degrades: no `herdr` binary or no running server and the buttons
simply don't render (`GET /api/herdr` → `available: false`). If the binary
lives somewhere unusual, point `HERDR_BIN` at it.

## Wayfinder mode

Set a project's `mode` to `wayfinder` and it becomes a home for [wayfinder](https://github.com/) maps. The mapping:

| Wayfinder concept | jTicket |
| --- | --- |
| Map | the project's **description** (the map body: Destination / Notes / Decisions / Fog / Out-of-scope) |
| Ticket | a **ticket** under that project; body = the question |
| Ticket sub-type | a `wayfinder:research\|prototype\|grilling\|task` **label** |
| AFK / HITL | the ticket **`type`** |
| Blocking | **`blockedBy`** |
| Claim | set **`assignee`** (an assigned ticket leaves the frontier) |
| Frontier | `GET /api/tickets?projectId=<project>&frontier=true` — todo + all `blockedBy` done + unassigned + takeable on this machine, key-ordered |
| Resolve | set `status: "done"`, fill **`resolution`**, add a gist to the map's *Decisions so far* |

In the UI, **every** project — wayfinder or standard — renders its tickets grouped into **Frontier · In progress · Blocked · Resolved**, key-ordered within each group, with frontier tickets ring-highlighted. What a wayfinder project adds on top is the map body (behind the board's Brief button) and the `wayfinder:<type>` sub-type badge on each card.

**Authoring a whole map** via `POST /api/import`: give the project `"mode": "wayfinder"` and a map-body `description`, and each ticket a `"wayfinderType": "research"` (shorthand that adds the `wayfinder:<type>` label) — e.g.:

```jsonc
{
  "projects": [{ "title": "Rive Story Assets", "mode": "wayfinder", "description": "## Destination\n…" }],
  "tickets":  [{ "title": "Choose the runtime", "project": "Rive Story Assets", "type": "AFK", "wayfinderType": "research" }]
}
```

## Pointing the `to-tickets` skill here

When the skill asks where to publish, tell it: **publish to the local jTicket app
via `POST http://localhost:43000/api/import`** instead of Jira. It maps cleanly:
skill "tickets" → tickets, "blocked by" → `blockedBy` (by title), AFK/HITL → `type`,
parent → `project`.

## The `to-jspec` skill

The companion `/to-jspec` skill (bundled at `.claude/skills/to-jspec`) teaches an LLM to
draft docs here via `POST /api/docs`, including the block-document format. It pairs
with Matt Pocock's `/to-spec`, which decides what the document says — `to-jspec` covers how
it is written and where it lands. Documents are drafts only — review them at
`http://localhost:43000/docs`, then copy into Confluence by hand if and when you want them
there.
