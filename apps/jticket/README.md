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
| `/` | Board — every project and its tickets, plus the document pool and the backlog |
| `/next` | **Up next** — the frontier across every project: open, unblocked, unclaimed tickets, each with its `/jimplement` hand-off command |
| `/running` | **Running now** — every in-progress ticket grouped by its project, with a link through to the project |
| `/finished` | **Recently finished** — every done ticket in completion order, newest first, grouped by the day it landed |
| `/projects` · `/projects/PROJ-1` | Project hub and project detail |
| `/documents` · `/documents/<key>` | **Docs** — the shared document pool, grouped by which project attaches each, and one document. (`/docs` redirects here.) |
| `/charts` · `/charts/<key>` | **Charts** — the shared chart pool and the workbench, served by `@jsuite/charting` |
| `/api-guide` | Full HTTP API reference, live in the app |

## Data model

- **Project** — `{ key: "PROJ-1", title, description, mode, repo, integrationBranch, attachments[] }`. Top-level grouping; contains tickets.
  - `mode`: `standard` (plain tracker) or `wayfinder` (see **Wayfinder mode** below). In a wayfinder project the `description` *is* the map body.
  - `repo` / `integrationBranch`: the optional GitHub link — see **GitHub** below. Both `""` when unset.
- **Ticket** — `{ key: "TICK-1", title, description, acceptanceCriteria[], type, status, projectId, assignee, labels[], resolution, blockedBy[], attachments[], completedAt }`
  - `projectId`: the parent project; `null` = backlog
  - `type`: `AFK` (agent-runnable) or `HITL` (needs a human)
  - `status`: `todo` · `in_progress` · `done`
  - `assignee`: free-form name of who is working on it — agents self-assign by name; `""` = unassigned. Filter with `GET /api/tickets?assignee=<name>`. In wayfinder terms, the assignee **is** the claim.
  - `labels`: free-form strings. Wayfinder uses `wayfinder:research|prototype|grilling|task` (the ticket sub-type). Filter with `GET /api/tickets?label=<label>`.
  - `resolution`: the answer recorded when the ticket resolves (GFM markdown); `""` until then.
  - `blockedBy`: ids of tickets that must finish first
  - `completedAt`: ISO timestamp of when the ticket last became `done`; `null` while unfinished. **Set by the server on the status change, never by the caller** — PATCHing it is ignored. Re-saving an already-done ticket keeps the original stamp, so fixing a resolution doesn't move it up `/finished`; moving a ticket out of `done` clears it, and moving it back stamps afresh. Tickets finished before the field existed were backfilled from `updatedAt`.
  - GET responses also attach derived booleans **`blocked`**, **`claimed`**, **`frontier`** (never persisted).
Every `description` / `resolution` field is **plain GFM markdown** and is
rendered as such in the UI (via the shared `@jsuite/documents` renderer). Card
summaries are the exception — they show a flattened plain-text preview so the
line clamp stays honest.

- **Known repo** — `{ path, slug, defaultBranch, lastUsedAt }`. Not a tracker
  record: the list of clones jTicket has been pointed at, so setting up the next
  project is a click. See **GitHub** below.

- **Attachment** — `{ type: "document" | "chart" | "diff", id }`. jTicket owns the
  ticket↔artifact link, and both projects and tickets carry an `attachments` array
  of these refs; the shared pools stay completely ignorant of tickets. There is no
  tracker record wrapping an artifact — a document belongs to a project by being
  attached to it.
  - `document` — a key in the shared jSuite document pool (`@jsuite/documents`;
    files in the root `.data/jexplain/` pool, which jExplain lists and renders too).
    Content is authored as **blocks** (prose, callout, code, diff, chart, steps,
    compare, timeline, takeaway + glossary). `POST /api/documents` writes one;
    `replace: true` rewrites it in place (notes survive). Rendered at `/documents/<key>`.
  - `chart` — a key in the shared jChart pool (root `.data/jchart/`).
  - `diff` — a review target: `"123"` for a PR, `"branch/<name>"` for a branch,
    read against the owning project's `repo`. jTicket extends `@jsuite/diff`, so
    it resolves to jTicket's own `/diffs/…` page and opens as a review card on
    the ticket — the verdict, the counts, and the way through to the full diff.
    A ref is a *locator*, not a promise the target still exists: it is never
    verified on resolve (that would mean git and `gh` per ref, per page load),
    so `missing: false` means "we know where to send you".
  - A ref is allowed to **dangle**. `GET /api/{projects,tickets}/:id/attachments`
    resolves each one to its title and url, flagging any whose artifact is gone as
    `missing` rather than erroring — so deleting an artifact never breaks a page.
  - Images inside prose are a different thing: `POST /api/attachments` with
    `{ name, base64 }` → serve from `/attachments/<name>`, reference as
    `![alt](/attachments/<name>)`.

## HTTP API

See **/api-guide** in the running app. Summary:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | List / create projects |
| GET/PATCH/DELETE | `/api/projects/:id` | Read / update / delete a project (id or key) |
| GET/POST | `/api/tickets` | List (`?projectId=`, `?status=`, `?finished=true`, `?since=`) / create tickets |
| GET/PATCH/DELETE | `/api/tickets/:id` | Read / update / delete a ticket (id or key) |
| POST | `/api/import` | Bulk-create a whole breakdown at once |
| GET/POST/DELETE | `/api/tickets/:id/attachments` | Resolve / attach / detach a ticket's artifacts |
| GET/POST/DELETE | `/api/projects/:id/attachments` | Same, for a project |
| GET/POST | `/api/documents` | The shared document pool (also served by jExplain) |
| GET/DELETE | `/api/documents/:key` | Read / delete one shared document |
| GET/POST | `/api/attachments` | List / upload image FILES for markdown (not artifact refs) |
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

A project can point at a **local clone** (`repo` — a path, `~` allowed: what a
review is computed against, `?repo=`) and own an **integration branch**: an *empty*
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
a chip naming the branch and opening its review once it exists.

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

  Every row opens the review **here** (`/diffs/pr/N?repo=…` — see Reviews
  below), and links out to **github.com** for the PR itself.

`gh` is best-effort: without it (offline, not logged in, no GitHub remote) the
branch side still works and the PR list reports why it's empty.

## Reviews

jTicket extends `@jsuite/diff`, so the whole review product runs here: the
screens at `/diffs` (repo picker), `/diffs/prs`, `/diffs/pr/<n>`,
`/diffs/branches`, `/diffs/branch`, plus the guidance pages — and the engine
behind them, `/api/diff`, `/api/prs`, the artifact stores and the claude
analysis runs. It is the same code jDiff serves at its own shorter routes, over
the same `.data/jdiff` pool: a review created here reads back identically there.

Two rules for anything that links to a review:

- **Never write a review path out.** Build it with `useDiffRoutes()` on the
  client or `diffRoutes(DIFF_BASE_PATH)` (`@jsuite/diff/routes`) on the server.
  A hardcoded `/pr/<n>` only works in jDiff, and a hardcoded `/diffs/pr/<n>`
  only works here.
- **The review surface brings its own palette.** `.diff-surface` is dark and
  scoped, so extending the layer doesn't repaint jTicket; `/diffs` is the one
  page that wears both (jTicket's header over the layer's ground), and
  `.diff-embed` is the same palette sized to its content, which is what the
  review card on a ticket uses.

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
| Frontier | `GET /api/tickets?projectId=<project>&frontier=true` — todo + all `blockedBy` done + unassigned, key-ordered |
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
draft docs here via `POST /api/documents`, including the block-document format and how to
attach the result to a project. It pairs
with Matt Pocock's `/to-spec`, which decides what the document says — `to-jspec` covers how
it is written and where it lands. Documents are drafts only — review them at
`http://localhost:43000/documents`, then copy into Confluence by hand if and when you want them
there.
