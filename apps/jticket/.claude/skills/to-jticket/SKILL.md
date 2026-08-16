---
name: to-jticket
description: Interface with jTicket — the local projects/tickets/docs tracker. Break a plan into tickets (to-tickets), author or update any project, ticket, doc or attachment, and query the board. For writing a spec as a doc, and for which format each field takes, use to-jspec.
disable-model-invocation: true
---

# To jTicket

[jTicket](http://localhost:43000) is a **local** task tracker — projects and tickets
(title, description, acceptance criteria, blocked-by edges) plus **docs**, draft
Confluence-style pages. It is not connected to Jira or Confluence and has no relation
to them. It exists so a breakdown or a document can be authored **locally first**, for
the user to review and edit before they hand-author anything elsewhere.

Everything is a plain HTTP call against `$JTICKET` (below). There is no CLI.

## 0. Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If it is **down**, tell the user and stop — do not write files as a fallback, and do
not start the server yourself unless they ask. The start command is `pnpm dev` in the
jTicket repo (`~/code/jTicket`).

Every write below is `-H 'content-type: application/json'`. Read the response of every
write: jTicket **silently drops** refs it cannot resolve (see [Gotchas](#gotchas)).

## 1. Pick the mode

| The user asks for | Do this |
| --- | --- |
| "break this into tickets", "/to-jticket tickets", a plan or spec to slice up | [Mode: tickets](#mode-tickets) |
| "add a ticket", "mark TICK-4 done", "what's on the board", any single read or write | [Mode: direct](#mode-direct) |
| "write a spec/PRD", "document this" | stop; use **`/to-jspec`** instead |
| anything wayfinder — charting a map, working a frontier | stop; use **`/jwayfinder`** instead |

Ambiguous between tickets and spec? A spec answers *what and why* as one document; tickets
answer *what to build next, in what order*. If the work is unscoped, `/to-jspec` first,
then tickets from that spec. Ask if it is genuinely a coin flip.

## 2. Core model

- **Project** `PROJ-n` — `{ key, title, description, mode, repo, integrationBranch }`. `mode` is
  `standard` or `wayfinder`. `repo` (path to a local clone) + `integrationBranch` are the
  optional GitHub link — see **GitHub** below; both `""` when unset.
- **Ticket** `TICK-n` — `{ key, title, description, acceptanceCriteria[], type, status, projectId, assignee, labels[], resolution, blockedBy[], comments[], completedAt }`
  - `projectId`: the parent project; `null` = backlog
  - `type`: `AFK` (an agent can take it cold) or `HITL` (needs a human)
  - `status`: `todo` · `in_progress` · `done`
  - `assignee`: free-form name; `""` = unassigned. **The assignee is the claim.**
  - `blockedBy`: ticket **ids** that must be `done` first
  - `comments`: `{ id, author, body, createdAt }[]` — a discussion thread on the ticket.
    The human uses it to leave direction *before* handing the ticket to an LLM, so
    **always read the comments before working a ticket**. LLMs comment too (questions,
    progress notes) under their own name. Append-only via its own endpoint — PATCH
    cannot touch it. The final answer still goes in `resolution`, not a comment.
  - `completedAt`: ISO stamp of when it last became `done`, `null` otherwise. **Server-set on the
    status change** — sending it does nothing. Editing a done ticket keeps the original stamp;
    moving out of `done` clears it. `GET /api/tickets?finished=true` lists done tickets
    newest-first, `&since=<ISO>` narrows the window.
  - GET responses also carry derived `blocked` / `claimed` / `frontier` booleans (never persisted)
- **Attachment** `{ type: 'document' | 'chart' | 'diff', id }` — an artifact ref. Both
  projects and tickets carry an `attachments` array; jTicket owns the link, and the
  shared pools stay ticket-ignorant. `id` is a **document** key (the pool jExplain also
  reads, rendered at `/docs/<key>`), a **chart** key (the jChart pool), or a jDiff review
  target (`'123'` for a PR, `'branch/<name>'`), read against the owning project's `repo`.
  There is no `DOC-n` wrapper record any more — a document belongs to a project by being
  attached to it. Attach and detach with `POST` / `DELETE
  /api/{projects,tickets}/:id/attachments`; `GET` the same path to resolve every ref to
  its title and url, with dangling ones flagged `missing`.

Keys are global and sequential across the whole store — `TICK-7` is the seventh ticket
ever created, not the seventh in its project.

Full endpoint list, query params, and payload shapes: **[reference/api.md](reference/api.md)**.
Document content is authored as blocks (the jExplain format — vocabulary in the
`j-explain` skill); descriptions and resolutions are plain GFM markdown. See **`to-jspec`**,
[SKILL.md](../to-jspec/SKILL.md), before writing any doc, description, or resolution.

## Mode: tickets

Break a plan, spec, or the current conversation into tracer-bullet tickets, each
declaring what blocks it, and publish the whole breakdown in one `POST /api/import`.

Follow **[reference/to-tickets.md](reference/to-tickets.md)** — it carries the vertical
slice rules, the wide-refactor exception, the quiz step, and the exact import call.

Short version: gather context → explore the codebase → draft vertical slices with
blocking edges → **present the numbered breakdown and iterate until the user approves**
→ publish via `POST /api/import`.

## Mode: direct

One-off reads and writes. Resolve the target first (keys are the friendly handle — accept
`TICK-4` from the user, never guess an internal id), then act.

```bash
# read the board
curl -s "$JTICKET/api/projects"
curl -s "$JTICKET/api/tickets?projectId=PROJ-2&status=todo"
curl -s "$JTICKET/api/tickets/TICK-4"

# add one ticket to an existing project
curl -s "$JTICKET/api/tickets" -H 'content-type: application/json' -d '{
  "title": "Persist the cart", "description": "…", "type": "AFK",
  "projectId": "PROJ-2", "acceptanceCriteria": ["Survives refresh"], "blockedBy": ["TICK-3"] }'

# update
curl -s -X PATCH "$JTICKET/api/tickets/TICK-4" -H 'content-type: application/json' \
  -d '{ "status": "done" }'

# comment on a ticket (author = your own name; body is GFM markdown)
curl -s "$JTICKET/api/tickets/TICK-4/comments" -H 'content-type: application/json' \
  -d '{ "author": "claude", "body": "Blocked on the schema question — see TICK-3." }'
```

### GitHub

A project can be wired to a local clone, which turns on its pull-request view:

```bash
# repos this tracker has been pointed at before — prefer one of these over
# guessing a path (each row carries its slug and which projects use it)
curl -s "$JTICKET/api/repos"

# wire the project to a repo (path, '~' allowed — the same path jDiff takes)
curl -s -X PATCH "$JTICKET/api/projects/PROJ-3" -H 'content-type: application/json' \
  -d '{ "repo": "~/code/my-repo" }'

# cut the integration branch: an EMPTY branch off the default branch, pushed to
# origin, that this project's PRs target. Idempotent — an existing branch is adopted.
curl -s "$JTICKET/api/projects/PROJ-3/integration-branch" \
  -H 'content-type: application/json' -d '{}'    # or { "branch": "...", "base": "..." }

# …or adopt a branch that already exists: search the repo's branches (local and
# on origin) and set the one you want — nothing is created or pushed
curl -s "$JTICKET/api/projects/PROJ-3/branches?q=checkout"
curl -s -X PATCH "$JTICKET/api/projects/PROJ-3" -H 'content-type: application/json' \
  -d '{ "integrationBranch": "release/checkout" }'

# the project's open PRs, each with a jDiff link and a github.com link
curl -s "$JTICKET/api/projects/PROJ-3/github"
```

A PR belongs to a project if its **head** is the integration branch (the roll-up PR),
its **base** is the integration branch, or its head branch / title names one of the
project's keys (`PROJ-3`, `TICK-12`). That last rule is worth exploiting:
**name the branch after the ticket** (`tick-12-persist-the-cart`) and the PR lands on
the project's list on its own.

Rules for direct writes:

- **Never delete** a project, ticket, or doc unless the user asks for that
  specific thing by key. Deletes are unrecoverable — the store is one JSON file.
- PATCH is a **field-level replace**, not a merge, for every array field. To add one
  `blockedBy` edge or one label, GET the current array, append, PATCH the whole thing.
- Report back by **key and title** (`TICK-4 — Persist the cart`), with the URL. Never
  quote a raw internal id at the user.

## Gotchas

These are the ways a write silently does the wrong thing. All of them are real.

1. **Only `/api/import` resolves refs by title.** `POST`/`PATCH` on `/api/tickets`
   resolve `blockedBy` and `projectId` by **id or key only** — a title is silently dropped,
   leaving the edge missing and no error. Use keys outside import.
2. **`/api/import` never upserts — it always creates.** Passing an existing project
   title in the `projects` array makes a *duplicate*. To add tickets to an existing
   project, send only `tickets` and reference the project by its key.
3. **Unresolvable refs vanish without error.** After any import or edge write, GET the
   tickets back and confirm `blockedBy` is populated as intended.
4. **`wayfinderType` shorthand exists only on import.** Elsewhere, set the
   `wayfinder:<type>` label explicitly in `labels`.
5. **Ticket POST/PATCH take `projectId`** (id or key) — not `project`. Docs take either
   `project` (id, key, **or** title) or `projectId`; import tickets take `project`.
6. **A ticket cannot block itself** — the API drops that edge.
7. **`blocked` / `claimed` / `frontier` are read-only**, computed per GET. Writing them
   does nothing.
8. **Attachment upload overwrites on name collision.** Prefix names to keep them unique.
9. **Comments are append-only, via their own endpoint.** `POST
   /api/tickets/:id/comments` adds one; PATCHing `comments` does nothing. Comments are
   the discussion (human direction before handoff, LLM questions and progress notes);
   `resolution` is still the one final answer. Read a ticket's comments before working
   it — the human may have left instructions there.
