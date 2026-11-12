---
name: to-jticket
description: Interface with jTicket — the local projects/tickets/docs tracker. Break a plan into tickets (to-tickets), author or update any project, ticket, doc or attachment, and query the board. Invoked as /to-jticket [tickets | TICK-n | PROJ-n | a request]. For writing a spec as a doc, and for which format each field takes, use to-jdoc.
argument-hint: "[tickets | TICK-n | PROJ-n | what to do]"
disable-model-invocation: true
---

# To jTicket

[jTicket](http://localhost:43000) is a **local** task tracker — projects and tickets
(title, description, acceptance criteria, blocked-by edges) plus **docs**, draft
Confluence-style pages. It is not connected to Jira or Confluence and has no relation
to them. It exists so a breakdown or a document can be authored **locally first**, for
the user to review and edit before they hand-author anything elsewhere.

Every call goes through `jt` (on PATH after `./jsuite setup`, else `bin/jt` in the jSuite checkout;
`jt help`), a thin CLI over jTicket's HTTP API — never hand-built `curl`.
`jt get|post|patch|put|delete PATH [JSON|@file.json|-]` reaches any endpoint without a
verb (`-` reads the body from stdin); `field=@file.md` reads a value from a file; lists
print tab-separated rows (`--json` for raw). The full API is in `reference/api.md`.

## 0. Connect first — always

```bash
jt projects >/dev/null && echo up || echo down
```

If it is **down**, tell the user and stop — do not write files as a fallback, and do
not start the server yourself unless they ask. jTicket is part of the jSuite — from the
`jsuite status`, then `jsuite start`.

Read the response of every write: jTicket **silently drops** refs it cannot resolve
(see [Gotchas](#gotchas)).

## 1. Pick the mode

| The user asks for | Do this |
| --- | --- |
| "break this into tickets", "/to-jticket tickets", a plan or spec to slice up | [Mode: tickets](#mode-tickets) |
| "add a ticket", "mark TICK-4 done", "what's on the board", any single read or write | [Mode: direct](#mode-direct) |
| "write a spec/PRD", "document this" | stop; use **`/to-jdoc`** instead |
| anything plan-mode — charting a map, working a frontier | stop; use **`/jplan`** instead |

Ambiguous between tickets and spec? A spec answers *what and why* as one document; tickets
answer *what to build next, in what order*. If the work is unscoped, `/to-jdoc` first,
then tickets from that spec. Ask if it is genuinely a coin flip.

## 2. Core model

- **Project** `PROJ-n` — `{ key, title, description, mode, repo, integrationBranch }`. `mode` is
  `standard`, `plan` (a map + its tickets — `/jplan`'s territory), `predeploy` (a pre-deploy bug
  sweep — each ticket is one suspected bug and dispatches `/jreproduce`, which reproduces it
  as a failing test and never fixes it), or the one mode you must never create with a plain
  POST: `todo` (a codebase's auto-created TODO list — see **Codebases** below). `repo` (path to a local clone) +
  `integrationBranch` are the optional GitHub link — see **GitHub** below; both `""` when unset.
  `repo` is also what scopes a project to a **codebase**.
- **Ticket** `TICK-n` — `{ key, title, description, acceptanceCriteria[], type, status, projectId, assignee, labels[], resolution, blockedBy[], comments[], branch, prompt, promptMode, completedAt, origin, owner, transfer, transferAt }`
  - `projectId`: the parent project; `null` = backlog
  - `type`: what kind of work it is — `story` (user-facing slice of value) · `task`
    (technical work) · `bug` (something broken) · `review` (review code/PR/doc) ·
    `verification` (confirm something works — QA, acceptance, post-deploy check) ·
    `research` (investigate; output is knowledge) · `decision` (a choice to make/grill
    out) · `docs` (write/refresh documentation). Omitted → what the labels/project mode
    imply, else `task`.
  - `labels`: free-form, plus the **tags** — exactly one of `afk` (an agent can take it
    cold) or `hitl` (needs a human; gets its own herdr tab); the server adds `afk` if
    neither. Optional `prototype` = throwaway work that must never ship, on any type.
  - `status`: `todo` · `in_progress` · `done` · `merged` (`merged` = its local PR landed;
    set by `POST /api/prs/:id/merge`, not by hand)
  - `assignee`: free-form name; `""` = unassigned. **The assignee is the claim.**
  - `blockedBy`: ticket **ids** that must be finished (`done` **or** `merged`) first
  - `branch`: the ticket's local work branch (`jt branch KEY` cuts it); `""` until cut
  - `prompt` / `promptMode`: the ticket's own hand-off text and how it layers on the
    resolved prompt (`append` · `replace` · `""`); machine-local
  - `origin` / `owner` / `transfer` / `transferAt`: shared-project ownership — which side
    minted the ticket, whose half it lives in, and a pending ownership transfer. Server-set;
    `""` on local-only projects. A peer-owned or mid-transfer ticket is read-only here
  - `comments`: `{ id, author, body, createdAt, origin, owner }[]` — a discussion thread on
    the ticket (`origin`/`owner` are the shared-project side, `""` locally).
    The human uses it to leave direction *before* handing the ticket to an LLM, so
    **always read the comments before working a ticket**. LLMs comment too (questions,
    progress notes) under their own name. Append-only via its own endpoint — PATCH
    cannot touch it. The final answer still goes in `resolution`, not a comment.
  - `completedAt`: ISO stamp of when it last became `done`, `null` otherwise. **Server-set on the
    status change** — sending it does nothing. Editing a done ticket keeps the original stamp;
    moving out of `done` clears it. `GET /api/tickets?finished=true` lists done tickets
    newest-first, `&since=<ISO>` narrows the window.
  - GET responses also carry derived `blocked` / `claimed` / `frontier` booleans (never persisted)
- **Doc** `DOC-n` — `{ key, title, documentKey, projectId, labels[], status }`. The
  content is a **block document** in the shared jSuite document system (`documentKey`
  points into the shared pool); `status` is `draft` or `ready`. Docs render
  at `/docs/DOC-n` — and the bare document at `/e/<documentKey>`.

Keys are global and sequential across the whole store — `TICK-7` is the seventh ticket
ever created, not the seventh in its project.

Full endpoint list, query params, and payload shapes: **[reference/api.md](reference/api.md)**.
Doc content is authored as blocks (vocabulary in the `j-explain`
skill); descriptions and resolutions are plain GFM markdown. See **`to-jdoc`**,
[SKILL.md](../to-jdoc/SKILL.md), before writing any doc, description, or resolution.

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
jt projects
jt ls projectId=PROJ-2 status=todo
jt show TICK-4

# add one ticket to an existing project
jt new PROJ-2 "Persist the cart" description=@desc.md type=story labels=afk \
  acceptanceCriteria="Survives refresh" blockedBy=TICK-3     # prints the new key
# acceptanceCriteria splits on newlines, labels / blockedBy on commas

# update
jt set TICK-4 status=done

# attach a screenshot to a ticket: upload, then embed the returned markdown in
# the description / resolution / a comment (see reference/api.md "Attachments")
jt post /api/attachments '{"file":"/tmp/shot.png","name":"tick-4-shot.png"}' | jq -r .markdown

# comment on a ticket (author = your own name; body is GFM markdown)
jt comment TICK-4 "Blocked on the schema question — see TICK-3."   # author: $JT_AUTHOR or claude
```

### Codebases

The UI is codebase-first: the user picks a local repo and everything is scoped to it.
On the API a codebase is just a repo path — projects belong to the codebase their
`repo` resolves to, and the list endpoints take `?repo=` (an absolute path, `~/…`, or
a known repo's `owner/name` slug):

```bash
# everything in the codebase you are working in
jt projects repo=$PWD
jt ls repo=$PWD status=todo    # backlog (no-project) tickets excluded
jt get "/api/docs?repo=$PWD"

# the codebase's TODO project — idempotent get-or-create, the ONLY way a
# todo-mode project is made (one per codebase; response carries created: true/false)
jt post /api/projects/todo "{ \"repo\": \"$PWD\" }"

# add a todo: a title-only ticket in that project (todos are one-liners the
# human exercises with the Grill button — don't pad them with descriptions)
jt new PROJ-7 "Work out the caching story"
```

### GitHub

A project can be wired to a local clone, which turns on its pull-request view:

```bash
# repos this tracker has been pointed at before — prefer one of these over
# guessing a path (each row carries its slug and which projects use it)
jt get /api/repos

# wire the project to a repo (path, '~' allowed)
jt patch /api/projects/PROJ-3 '{ "repo": "~/code/my-repo" }'

# cut the integration branch: an EMPTY branch off the default branch, pushed to
# origin, that this project's PRs target. Idempotent — an existing branch is adopted.
jt post /api/projects/PROJ-3/integration-branch '{}'    # or { "branch": "...", "base": "..." }

# …or adopt a branch that already exists: search the repo's branches (local and
# on origin) and set the one you want — nothing is created or pushed
jt get "/api/projects/PROJ-3/branches?q=checkout"
jt patch /api/projects/PROJ-3 '{ "integrationBranch": "release/checkout" }'

# the project's open PRs, each with a Diff tab link and a github.com link
jt get /api/projects/PROJ-3/github
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
4. **`type` is the kind of work; AFK/HITL is a tag.** Send `"type": "bug", "labels":
   ["hitl"]` — not the legacy `"type": "HITL"` (still accepted, folded into the tag, but
   don't write it). PATCHing `labels` replaces them all, so keep the agency tag when you
   rewrite them (a set without `afk`/`hitl` keeps the current one).
5. **Ticket POST/PATCH take `projectId`** (id or key) — not `project`. Docs take either
   `project` (id, key, **or** title) or `projectId`; import tickets take `project`.
6. **A ticket cannot block itself** — the API drops that edge.
7. **`blocked` / `claimed` / `frontier` are read-only**, computed per GET. Writing them
   does nothing.
8. **Images go in two different stores.** Ticket markdown (description, resolution,
   comments) embeds `POST /api/attachments` uploads (`{ file }` or `{ name, base64 }` →
   use the returned `markdown`). Doc content carries pictures as `image` blocks (`file`
   or `base64`), never `/attachments/…` links — the document reader can't serve those. Attachment
   upload **overwrites on name collision**; prefix names to keep them unique.
9. **Comments are append-only, via their own endpoint.** `POST
   /api/tickets/:id/comments` adds one; PATCHing `comments` does nothing. Comments are
   the discussion (human direction before handoff, LLM questions and progress notes);
   `resolution` is still the one final answer. Read a ticket's comments before working
   it — the human may have left instructions there.
