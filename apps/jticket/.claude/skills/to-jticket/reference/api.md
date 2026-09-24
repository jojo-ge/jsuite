# jTicket HTTP API

Base URL `$JTICKET` = `${JTICKET_URL:-http://localhost:43000}`. Every write is JSON:
`-H 'content-type: application/json'`. The running app also serves a live reference at
`$JTICKET/api-guide`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/projects` | List / create projects |
| POST | `/api/projects/todo` | Get-or-create a codebase's TODO project (idempotent; the only way to make a `todo`-mode project) |
| POST | `/api/projects/architect` | Create an architecture-review project + its `arch:scan` ticket (one per scan, never reused; the only way to make an `architect`-mode project) |
| GET / PATCH / DELETE | `/api/projects/:id` | One project (id **or** key) |
| GET / POST / PATCH / DELETE | `/api/repos` | Known repos = **codebases** (POST remembers a path after probing it; PATCH `?path=` `{prompts}` sets the codebase's prompt overrides; DELETE `?path=` forgets it and its settings) |
| GET / PUT / DELETE | `/api/repos/worktree?repo=` | The codebase's **worktree guide** — how it creates, sets up, runs and tears down worktrees. Read it before making any worktree |
| GET / POST / DELETE | `/api/projects/:id/worktree` | The integration branch's **worktree link** (status re-checked against git; POST `{path, notes, author}` records it) |
| GET | `/api/repos/probe?path=` | Is this path a usable git clone? (answers, never errors) |
| GET / POST | `/api/tickets` | List / create tickets |
| GET / PATCH / DELETE | `/api/tickets/:id` | One ticket (id or key) |
| POST | `/api/tickets/:id/comments` | Add a comment to a ticket |
| DELETE | `/api/tickets/:id/comments/:commentId` | Delete one comment |
| POST | `/api/import` | Bulk-author a whole breakdown |
| POST | `/api/tickets/:id/branch` | Cut the ticket's local work branch off the integration branch |
| GET / POST | `/api/prs` | List / open **local PRs** (ticket branch → integration branch, merged by jTicket) |
| GET / PATCH / DELETE | `/api/prs/:id` | One local PR (id or `PR-n`); PATCH status only to `closed` / `open` |
| POST | `/api/prs/:id/merge` | Squash-merge locally; deletes the branch, ticket → `merged`; 409 on conflict |
| POST | `/api/projects/:id/sync` | Push the integration branch to origin (the only remote write) |
| POST | `/api/projects/:id/integration-pr` | Push + open (or find) the GitHub roll-up PR via `gh` |
| GET / POST | `/api/docs` | List / create docs |
| GET / PATCH / DELETE | `/api/docs/:id` | One doc (id or key) |
| GET / POST | `/api/attachments` | List / upload attachments (images for ticket markdown) |
| GET | `/attachments/:name` | Serve an uploaded file |

`:id` accepts the internal id or the human key (`PROJ-1`, `TICK-7`, `DOC-3`).

## Query params

```
GET /api/tickets?projectId=PROJ-2   # project id or key
                &repo=<path|slug>   # codebase scope: tickets in that repo's projects
                &status=todo|in_progress|done|merged
                &assignee=<exact name>
                &label=<exact label>
                &frontier=true      # todo + unblocked + unassigned + yours, key-ordered
                &finished=true      # done + merged tickets, newest completedAt first
                &since=<ISO>        # completedAt >= this (pairs with finished=true)
GET /api/projects?repo=<path|slug>
GET /api/docs?projectId=PROJ-1&repo=<path|slug>&status=draft|ready&label=<label>
GET /api/prs?projectId=PROJ-2&repo=<path|slug>&ticket=TICK-7&status=open|conflicted|merged|closed
```

`repo` accepts an absolute path, `~/…`, or a known repo's `owner/name` slug; a project
belongs to the codebase its `repo` field resolves to. Backlog tickets and project-less
docs belong to no codebase, so `?repo=` excludes them. Every project in a GET response
carries a derived read-only `repoPath` (its `repo` with `~` resolved).

Filters combine with AND. `frontier=true` is applied last and sorts by key number
(`TICK-9` before `TICK-10`).

Every ticket in a GET response is augmented with three **read-only derived** booleans:

- `blocked` — some ticket in `blockedBy` is not finished (`done` or `merged`)
- `claimed` — `assignee` is non-empty
- `frontier` — `status === "todo"` && !claimed && !blocked && takeable on this machine:
  a ticket mid-ownership-transfer, or one owned by the peer of a shared project, is
  read-only and undispatchable here, so it never reads as frontier

`completedAt` is also read-only, but it **is** persisted: the server stamps it when a
ticket moves into `done` or `merged` and clears it when it moves out. Sending it in a
POST/PATCH body is ignored. Editing an already-finished ticket keeps the original stamp,
so a resolution fix doesn't reorder `?finished=true`.

Ticket statuses: `todo → in_progress → done → merged`. `done` means built and recorded;
`merged` means its **local PR** landed on the integration branch — normally set by
`POST /api/prs/:id/merge`, not by hand. Both count as finished everywhere (blocking, the
frontier, `?finished=true`).

## Payloads

### Project

```jsonc
POST /api/projects
{ "title": "Checkout",                  // required
  "description": "Everything payments-related",
  "repo": "~/code/my-repo",             // the codebase this project belongs to
  "mode": "standard" }                  // or "wayfinder" / "jmap" / "predeploy"; anything else → "standard"
                                        // ("todo" and "architect" have their own endpoints below — don't POST them here)
```

`PATCH /api/projects/:id` accepts the same fields; omitted fields are untouched.

### TODO project (per codebase)

Every codebase gets exactly one `todo`-mode project — its human-written todo list,
whose one-liner tickets the UI exercises with a Grill button (a jGrilling interview).
Never POST one directly; use the idempotent get-or-create:

```jsonc
POST /api/projects/todo
{ "repo": "~/code/my-repo" }            // must be a real git clone (probed)
→ 201 { "key": "PROJ-7", "mode": "todo", "created": true, ... }   // first call
→ 200 { "key": "PROJ-7", "mode": "todo", "created": false, ... }  // every later call
```

A todo is then a title-only ticket POSTed with that project's key.

### Architect project (one per scan)

An architecture review of a codebase — the projects page's Improve-architecture
button calls this, and so can an agent. Not idempotent: every call is a fresh
review (a fresh run is a fresh project). Creates the `architect`-mode project
plus its `arch:scan` ticket; dispatching that ticket into herdr
(`/jarchitect-scan TICK-n`) fills the board with graded `hitl` `decision` tickets
(`arch:candidate`) and publishes the assessment spec doc.

```jsonc
POST /api/projects/architect
{ "repo": "~/code/my-repo" }            // must be a real git clone (probed)
→ 201 { "project": { "key": "PROJ-8", "mode": "architect", ... },
        "ticket":  { "key": "TICK-31", "labels": ["arch", "arch:scan"], ... } }
```

### Predeploy project (a bug sweep before a deploy)

A board of **suspected bugs standing between a codebase and a deploy** — one report per
ticket, written by whoever saw it. Plain `POST /api/projects` with `"mode": "predeploy"`;
there is no dedicated endpoint and nothing is auto-created.

```jsonc
POST /api/projects
{ "title": "Predeploy — 4.2 release", "repo": "~/code/my-repo", "mode": "predeploy" }
→ 201 { "key": "PROJ-9", "mode": "predeploy", ... }
```

Each ticket is one bug: the `description` is the human's report (an agent must never
rewrite it) and the `acceptanceCriteria` are the observable, if they pinned one.
Dispatching a ticket into herdr fires **`/jreproduce TICK-n`** instead of `/jimplement`:
it reproduces the bug in a throwaway git worktree as a **failing test**, then writes the
finding back and deletes the worktree. It never fixes anything, cuts no branch and opens
no PR — the resolution IS the hand-off to `/jimplement`.

What lands on the ticket when it finishes:

| Field | What the reproduction puts there |
| --- | --- |
| `status` | `done` for every verdict; `in_progress` while `blocked` / `unclear` waits on the human |
| `resolution` | Verdict + blocks-the-deploy call, what happens, **the failing test verbatim** with its path and run command, the failure output, where the bug lives |
| `labels` | `predeploy:<verdict>` appended — `reproduced` · `flaky` · `not-reproduced` · `already-fixed` · `invalid` · `unclear` · `blocked` |
| a doc | Only when the repro is too big for a resolution: labelled `predeploy` + `predeploy:repro` on the project, linked from it |

```bash
# what the sweep found, at a glance
curl -s "$JTICKET/api/tickets?projectId=PROJ-9" | jq '.[] | {key, title, status, labels}'
curl -s "$JTICKET/api/tickets?label=predeploy:reproduced" | jq '.[].key'
```

### Ticket

```jsonc
POST /api/tickets
{ "title": "Persist the cart",          // required
  "description": "What to build, from the user's perspective",
  "acceptanceCriteria": ["Survives refresh"],
  "type": "story",                      // story | task | bug | review | verification | research | decision | docs
                                        // omitted → implied by labels / project mode, else "task"
  "status": "todo",                     // todo | in_progress | done
  "projectId": "PROJ-2",                // id or KEY only — 400 if unknown
  "assignee": "",                       // free-form name; "" = unassigned
  "labels": ["afk"],                    // tags: exactly one of "afk" | "hitl" (+ optional "prototype"); rest free-form
  "resolution": "",                     // the answer, GFM markdown
  "blockedBy": ["TICK-3"] }             // ids or KEYS only — unknown refs DROPPED silently
```

`PATCH /api/tickets/:id` — same fields, all optional.

**Type vs tags.** `type` is what kind of work the ticket is:

| `type` | For |
| --- | --- |
| `story` | a user-facing slice of value |
| `task` | a unit of technical work (the default) |
| `bug` | something broken |
| `review` | reviewing code, a PR or a doc |
| `verification` | confirming something works — QA, acceptance, a post-deploy check |
| `research` | investigating a question; the output is knowledge |
| `decision` | a choice to make or grill out |
| `docs` | writing or refreshing documentation |

Agency is a **tag** in `labels`: every ticket carries exactly one of `afk` (an agent can
take it cold) or `hitl` (needs a human; gets its own herdr tab) — the server adds `afk`
when neither is sent. `prototype` marks throwaway work that must never ship and
combines with any type (a wayfinder prototype is `research` + `prototype`). With no
`type`, the server infers one: `arch:scan` → `research`, `arch:candidate` → `decision`,
`jmap:*` or a jmap project → `docs`, `review:finding` or a predeploy project → `bug`,
else `task`. Legacy input — `"type": "AFK" | "HITL"`, `wayfinder:<sub-type>` labels —
is still accepted and folded into this shape; don't send it.

- `description`, `resolution` and comment bodies are GFM markdown and render images:
  upload with [`POST /api/attachments`](#attachments) and embed the returned `markdown`
  (`![name](/attachments/<name>)`). The UI's paste / drop / **Attach image** does the same.

- Array fields (`acceptanceCriteria`, `labels`, `blockedBy`) are **replaced wholesale**.
  Read-modify-write to append.
- `assignee: ""` unassigns. `resolution: ""` clears.
- `projectId: null` detaches (→ backlog). A self-blocking edge is dropped.
- Labels are trimmed, emptied-out, and de-duplicated on the way in. A PATCHed `labels`
  with no `afk`/`hitl` keeps the ticket's current agency tag.
- `comments` is **not PATCHable** — use the comments endpoint below.

### Ticket comments

A discussion thread on the ticket, returned inline on every ticket GET as
`comments: [{ id, author, body, createdAt }]`. The human leaves direction here before
handing a ticket to an LLM — **read them before working a ticket**. LLMs post their own
comments (questions, progress notes) under their own name; the final answer still
belongs in `resolution`.

```jsonc
POST /api/tickets/:id/comments
{ "author": "claude",                   // free-form name; omitted → "anonymous"
  "body": "Started on this — the schema needs a migration first." }  // required, GFM markdown
→ 201 { "id": "cmt_…", "author": "claude", "body": "…", "createdAt": "…" }
```

`DELETE /api/tickets/:id/comments/:commentId` removes one comment (`:commentId` is the
comment's `id`, not an index). There is no comment edit — delete and re-post.

### Local PRs

GitHub for the local repo: a local PR is one **ticket branch** squash-merged onto the
project's **integration branch** by jTicket itself — no push, no GitHub, no diffs (jDiff
renders those). Exactly one ticket per PR, one open PR per ticket. The flow:

```bash
# 1. Cut the ticket's branch (off the integration branch, local only, recorded on the ticket)
curl -s -X POST "$JTICKET/api/tickets/TICK-7/branch" -H 'content-type: application/json' -d '{}'
# → { "branch": "tick/TICK-7-persist-cart", "base": "proj/PROJ-2-checkout", "created": true }

# 2. ...commit work on that branch, mark the ticket done, then open the PR
curl -s "$JTICKET/api/prs" -H 'content-type: application/json' \
  -d '{ "ticket": "TICK-7", "description": "Persists the cart via localStorage." }'
# → 201 { "key": "PR-4", "title": "TICK-7 Persist the cart", "status": "open",
#         "headBranch": "tick/TICK-7-persist-cart", "baseBranch": "proj/PROJ-2-checkout",
#         "commits": [...] }
# title defaults to "<TICK-n> <ticket title>"; description becomes the squash commit body.

# 3. The human merges from the UI — or:
curl -s -X POST "$JTICKET/api/prs/PR-4/merge"
# Success: squash commit on the integration branch, ticket branch deleted, ticket → merged.
# Conflict: 409, PR status → "conflicted" with conflictFiles, the repo left untouched.
#   Fix = rebase the ticket branch onto the integration branch, then POST the merge again.
# The merge never touches the working tree (plumbing merge) — a dirty checkout is fine
# unless the *integration branch itself* is checked out dirty (409, says so).
```

Everything stays on the machine until `POST /api/projects/:id/sync` pushes the
integration branch. `POST /api/projects/:id/integration-pr` opens the one real GitHub
roll-up PR (integration → default branch) via `gh`.

### Codebase worktrees

Every codebase does worktrees differently, so jTicket asks the codebase and keeps the
answer: the **worktree guide**. Anything that makes a worktree reads it first.
`?repo=` takes a path, `~/…` or an `owner/name` slug.

```bash
curl -s -G "$JTICKET/api/repos/worktree" --data-urlencode "repo=~/code/checkout"
# → { "repo": "/Users/you/code/checkout", "state": "ready" | "stale" | "missing",
#     "changed": [],            # stale: source files that changed since it was written
#     "guide": { "body": "<markdown>", "root": "/abs/dir/worktrees/go/under or ''",
#                "sources": [{ "path": "pnpm-lock.yaml", "hash": "…" }],
#                "verified": true, "author": "claude", "updatedAt": "…" } | null }

# The kickoff agent writes it (replaces the whole guide; sources are hashed now):
curl -s -X PUT "$JTICKET/api/repos/worktree" --url-query "repo=$REPO" \
  -H 'content-type: application/json' \
  -d '{ "body": "## Create\n…", "root": "../checkout-worktrees",
        "sources": ["pnpm-lock.yaml", "CLAUDE.md", ".env.example"], "verified": true, "author": "claude" }'
```

A project's integration branch can be **connected** to a worktree made from the guide
(the GitHub panel's Connect worktree button dispatches an agent to do it). The link is
one per branch, stored on the codebase, and always re-checked against `git worktree list`:

```bash
curl -s "$JTICKET/api/projects/PROJ-2/worktree"
# → { "state": "linked" | "broken" | "unlinked-checked-out" | "unlinked" | "no-branch" | "no-repo",
#     "branch": "proj/PROJ-2-checkout", "checkedOutAt": "/abs/path" | null,
#     "link": { "path": "…", "notes": "<markdown: how to run it>", … } | null,
#     "guide": { "state": "ready", … } }

# Record it — 409 unless path is a worktree of the repo (not its main checkout)
# with the integration branch checked out:
curl -s "$JTICKET/api/projects/PROJ-2/worktree" -H 'content-type: application/json' \
  -d '{ "path": "/Users/you/code/checkout-worktrees/proj-2", "notes": "pnpm dev --port 3102", "author": "claude" }'
```

jTicket squash-merges local PRs into the integration branch and resets a checked-out
integration worktree to each merge — it refuses while that worktree is dirty, so keep
set-up artefacts gitignored.

### Doc

```jsonc
POST /api/docs
{ "title": "Checkout spec",             // required
  "blocks": [                           // block document (jExplain format) — see to-jdoc / j-explain
    { "type": "prose", "md": "## Problem Statement\n…" },
    { "type": "image", "file": "/abs/path/shot.png", "alt": "…" }   // or "base64": "…" — see Images
  ],
  "subtitle": "One-line standfirst.",   // optional document header extras
  "kicker": "SPEC",
  "glossary": { "TTL": "time-to-live" },
  "documentKey": "existing-key",        // OR link an existing shared document instead of blocks
  "project": "Checkout",                // id, KEY, or exact TITLE — 400 if unknown
  "labels": ["spec"],
  "status": "draft" }                   // draft | ready; anything else → "draft"
```

`PATCH /api/docs/:id` — same fields. Metadata updates the record; `blocks` /
`glossary` / `subtitle` / `kicker` rewrite the backing shared document wholesale
(notes and unchanged charts survive). `project: null` or `""` detaches.
`projectId` is accepted as a synonym for `project` and resolves the same three ways.
DELETE removes the record but leaves the shared document in the pool.

Docs render at `$JTICKET/docs/DOC-n` and are listed at the top of the board. The
shared pool itself is at `GET /api/documents` (also served by jExplain — one
document system, two apps).

### Attachments (images in ticket markdown)

The attachment store is for anything that renders **markdown** — ticket `description`,
`resolution`, comments, project descriptions. Upload, then embed the `markdown` the
response hands back. Doc content does **not** use this: a doc carries pictures as
`image` blocks (below), which jExplain can serve too.

```jsonc
POST /api/attachments
{ "name": "checkout-flow.png",
  "base64": "iVBORw0KGgo…" }            // bare base64 or a full data: URL (`dataUrl` is a synonym)
// — or, when the file is on this machine —
{ "file": "/abs/path/checkout-flow.png",
  "name": "flow.png" }                  // optional; defaults to the file's own name
→ 201 { "name": "checkout-flow.png", "url": "/attachments/checkout-flow.png", "size": 20480,
        "markdown": "![checkout-flow.png](/attachments/checkout-flow.png)" }
```

- Images (png/jpg/gif/webp/svg) get `![…](…)` markdown; anything else (pdf, csv, txt,
  json) gets a plain link. Max 12MB.
- Names are sanitised to `[\w.-]` and stripped of directories. **Same name overwrites** —
  no versioning, no warning — so prefix names to keep them unique.
- `GET /api/attachments` lists what's stored; files serve from `/attachments/<name>`
  (jTicket only — that path doesn't exist in jExplain, which is why docs use image blocks).

```bash
# a screenshot already on disk → into a ticket description
MD=$(curl -s "$JTICKET/api/attachments" -H 'content-type: application/json' \
  -d '{"file":"/tmp/flow.png","name":"tick-7-flow.png"}' | jq -r .markdown)
curl -s -X PATCH "$JTICKET/api/tickets/TICK-7" -H 'content-type: application/json' \
  -d "$(jq -n --arg md "$MD" '{description: ("What to build…\n\n" + $md)}')"

# from bytes you hold (e.g. a remote client)
curl -s "$JTICKET/api/attachments" -H 'content-type: application/json' \
  -d "$(jq -n --arg n 'checkout-flow.png' --arg b "$(base64 -i ./flow.png)" '{name:$n, base64:$b}')"
```

### Images in docs (`image` blocks)

A doc's pictures are **`image` blocks**, stored beside the document in
`.data/jexplain/media/<documentKey>/` and served at `/api/media/<documentKey>/<file>`
(by jTicket and jExplain alike). Give the block its bytes one of three ways:

```jsonc
{ "type": "image", "file": "/abs/path/shot.png", "alt": "…", "caption": "…" }   // local path — copied in
{ "type": "image", "base64": "iVBOR…", "name": "shot.png", "alt": "…" }         // inline; `dataUrl` also works
{ "type": "image", "src": "/api/media/<key>/shot.png" }                          // already stored (a republish)
```

Optional `title`, `caption` (markdown), `width` (px), `framed` (default true). The full
block reference is the `j-explain` skill. Republishing (`PATCH /api/docs/:id` with `blocks`)
prunes media the new blocks no longer reference — so a republish must send existing
image blocks back with their `src`, which GET `/api/documents/<key>` gives you.
The doc page's **Add image** button (and paste / drop onto the page) appends an image
block the same way.

## Bulk import

`POST /api/import` authors a whole breakdown in one call. This is the **only** endpoint
that resolves references by **title**, which is what makes it usable before any id exists.

```jsonc
{
  "projects": [{ "title": "Checkout", "description": "…", "mode": "standard" }],
  "tickets":  [
    { "title": "Add cart schema", "description": "Persist a cart.", "type": "task",
      "labels": ["afk"],
      "project": "Checkout",                      // project title or key
      "acceptanceCriteria": ["Survives refresh"] },
    { "title": "Cart UI", "description": "Edit quantities.", "type": "story",
      "labels": ["hitl"],
      "project": "Checkout",
      "blockedBy": ["Add cart schema"] }          // ticket TITLES or keys
  ]
}
→ 201 { "projects": [...], "tickets": [...] }   // with generated keys
```

- Both arrays are optional. Order within the call does not matter: projects are
  created, then tickets, then `blockedBy` edges are wired in a second pass — so a
  ticket may block-reference one declared later in the same array.
- Tickets take the same `type` + `labels` tags as `POST /api/tickets`. (A legacy
  `wayfinderType` shorthand is still accepted here and folded into type + tags — don't
  write it; set `type` instead.)
- **It always creates.** There is no upsert. Re-running the same import duplicates
  everything. To extend an existing project, send only `tickets` and reference the
  project by key.
- Unresolvable `project` / `blockedBy` refs are **dropped silently** — the
  ticket is still created, just unparented or unblocked. Always verify:

```bash
curl -s "$JTICKET/api/tickets?projectId=PROJ-2" | jq '.[] | {key, title, blockedBy, blocked}'
```

## Storage

One human-editable JSON file at `<jSuite root>/.data/jticket/jticket.json`. Deletes are
immediate and unrecoverable — there is no trash and no undo.
