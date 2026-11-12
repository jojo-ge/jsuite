---
name: jimplement
description: Implement a jTicket ticket — claim it, build it in a worktree, open its PR and record the outcome on the board.
disable-model-invocation: true
argument-hint: "[TICK-n]"
---

# jImplement

`/implement`, driven by [jTicket](http://localhost:43000). The tickets are the spec: read
the work from the board, claim it before touching code, build it, and write the outcome
back so the next session — or another human — can see what happened without reading the
diff.

This skill **does** the work. If the way to the destination isn't clear yet — decisions
still open, questions to resolve — that's `/jplan`, not this. If there's no
breakdown at all yet, that's `/to-jticket` in tickets mode first.

Who runs it: a person typing `/jimplement [TICK-n]` (or a project key, or nothing),
jTicket's herdr buttons, its auto loop and run plans. An orchestrator's subagent reads
this file by path instead.

## Connect first — always

```bash
jt projects >/dev/null && echo up || echo down
```

If it is **down**, tell the user and stop: the board is the only source of the work, and
the server starts when they ask for it. jTicket is
`apps/jticket` of the jSuite checkout (`jsuite root`); `jsuite status`, then `jsuite start`
(starts every app).

Every call below goes through `jt` (on PATH after `./jsuite setup`; else
`bin/jt` in the jSuite checkout; `jt help`), every endpoint included. It
prints a ticket or project as JSON, lists as tab-separated rows (`--json` for raw), reads a
field from a file with `field=@file.md`, and reaches any endpoint without a verb as
`jt get|post|patch|put|delete PATH [JSON]`.

API reference: the `to-jticket` skill's [reference/api.md](../to-jticket/reference/api.md).
Markdown dialect for anything you write into a description or resolution: the `to-jdoc`
skill, [SKILL.md](../to-jdoc/SKILL.md).

## 1. Choose the ticket

The user invokes with a ticket key, a project key, a name, or nothing at all.

```bash
# they named a ticket
jt show TICK-7

# they named a project — take the first frontier ticket, in key order
jt ls projectId=PROJ-2 frontier=true --json | jq '.[0]'

# they named nothing — show the board and ask which project
jt projects
```

The **frontier** is `todo` + unblocked + unclaimed + takeable on this machine (on a
shared project the peer's tickets are read-only here, so they never surface), and jTicket
computes it for you.
Start only tickets whose `blocked` is `false` — a blocked ticket's blockers hold facts you need. If the
frontier is empty but tickets remain, say so and stop; something is blocked or claimed.

A ticket's `type` says what kind of work it is (`story`, `task`, `bug`, `review`,
`verification`, `research`, `decision`, `docs`); its agency is a tag in `labels`.
A **`hitl`** ticket needs the human in the loop. Confirm they're here for it before
claiming, and leave their side of it to them. Put its questions to them **in this
terminal** (`/grilling`) — they come to the herdr pane to answer. **`afk`** tickets you can take cold. A
**`prototype`**-tagged ticket is throwaway work that stays on its branch — build it to
answer its question, with no PR and no merge.

## 2. Claim it — before any work

Assignee first, so a concurrent session skips it. The assignee *is* the claim.

```bash
jt set TICK-7 assignee=claude status=in_progress
```

## 3. Load the context

- The ticket's `description` (what to build) and `acceptanceCriteria` (when it's done).
- The ticket's `comments` — the human leaves direction there before handing a ticket
  over. A comment can narrow, extend, or override the description; if a comment and the
  description conflict, the newer comment wins (raise it if that's ambiguous).
- The `resolution` of every ticket in its `blockedBy` — that's where the decisions this
  ticket rests on were recorded.
- Any doc the description links. `/api/docs/DOC-n` is only the tracker record; the
  content lives in the shared document pool:
  `jt get /api/documents/$(jt get /api/docs/DOC-n | jq -r .documentKey)`.

```bash
jt show TICK-7 | jq '{title, description, acceptanceCriteria, blockedBy, comments}'
jt show TICK-3 | jq -r '.resolution'
```

If the ticket contradicts the codebase, or the acceptance criteria can't be met as
written, **stop and raise it** rather than quietly reinterpreting the ticket. Record what
you found and hand it back (§6).

## 4. Build it

### In the codebase's worktree — its way, not a generic one

When the hand-off says "in a worktree", the worktree is made the way **this
codebase** does worktrees. Every codebase differs (deps, env files, ports,
a script of its own), so jTicket keeps each codebase's answer as its **worktree
guide** — ask for it before creating anything:

```bash
REPO="$(jt project PROJ-2 | jq -r .repo)"
jt get "/api/repos/worktree?repo=$(jq -rn --arg r "$REPO" '$r|@uri')" \
  | jq '{state, changed, root: .guide.root, body: .guide.body}'
```

- **`ready`** — follow `body` for where the worktree goes, how it is created,
  set up, run, tested and torn down. Check the ticket's branch out into it (the
  branch jTicket cut, or your own). Take the **cheapest form the guide offers
  that your ticket needs** — most tickets only run tests, lint and typecheck,
  and a guide's slim/test-only form is for exactly that; reach for the full
  form only when you must run the app, a browser, or something the guide says
  the slim form lacks.
- **`stale`** — follow it, but `changed` names files that moved since it was
  written; adapt where they disagree and say so in your report.
- **`missing`** — no guide yet: a plain `git worktree add` next to the repo,
  set up the way the repo's `CLAUDE.md`/`AGENTS.md` says. Tell the human the
  codebase has no guide (Codebase settings → Worktrees → Run kickoff).

Tear down the way the guide says once the PR is open — unless the hand-off
says otherwise. The PR holds the commits, so anything still uncommitted in the
worktree is disposable: use the guide's forced form rather than leaving the
worktree behind (a refused non-interactive teardown is not a reason to skip
it). Keep the branch — the merge sweep deletes it after merging. If teardown
fails anyway, name the path in your report. Build only in the worktree.

Standard `/implement` discipline, plus the project's own conventions — read the repo's
`CLAUDE.md`/`AGENTS.md` and invoke whatever skills it names for the layers you're
touching.

- Use `/tdd` where possible, at pre-agreed seams.
- Typecheck regularly; run single test files as you go; run the full suite once at the end.
- Scope the change to the ticket. Work you discover that belongs to a *different* ticket
  goes on the board (§6), not into this diff.
- Once done, use `/code-review` to review the work — unless the hand-off comes from an
  orchestrator (jTicket's orchestrated auto loop), which spec-checks it instead.

### Commits and the PR

Every commit subject **starts** with the key that owns the branch, so the board key is
readable from `git log`, from the PR list, and from a squashed merge subject:

- **A ticket branch** — one ticket's work — takes the **ticket** key:
  `TICK-7 feat(cart): persist across refresh`.
- **An integration branch** — the shared branch several tickets in a project land on
  before a final integrate-and-verify — takes the **project** key:
  `PROJ-2 feat(cart): migrate the checkout call sites`.

The same prefix goes in the PR title, and it is the branch's prefix, not the prefix of
whichever ticket you happen to be on: opening a PR from an integration branch titled
`TICK-9 …` hides the fact that it carries the whole project. Name the branch to match
(`tick-7-persist-cart`, `proj-2-cart-migration`).

Only open a PR when the user asks for one — and note **which kind** they asked for:

**A LOCAL PR** ("local PR", "PR in jticket", or the hand-off prompt says so) is jTicket's
own review unit: ticket branch → integration branch, merged by jTicket with a squash —
**everything stays on this machine — no push, no `gh`**. The prompt usually names the branch
jTicket already cut (`on the existing branch tick/TICK-7-…`); work on that branch. If it
doesn't, cut one first:

```bash
jt branch TICK-7
# → { "branch": "tick/TICK-7-persist-cart", ... }  (off the integration branch, local only)
```

**The order is fixed: commit → open the PR → mark the ticket `done`, last.** A `done` ticket on a local-PR hand-off means "its PR exists and is ready to merge"
— jTicket's auto loop starts the merge sweep the moment every ticket is `done`, and a PR
that lands a few seconds later is skipped: never merged, never reviewed.

1. **Commit** the work on the ticket branch.
2. **Open the PR** as soon as there is committed work to show. The description becomes
   the squash commit body, so write it like one:

   ```bash
   jt post /api/prs '{ "ticket": "TICK-7", "description": "Persists the cart via localStorage; survives refresh." }'
   ```

   Check the response carries a PR `key`. If the call fails, the ticket is **not**
   finished — fix what it complains about and open it again. Mark `done` as the last call,
   after the PR exists.
3. **Keep working if there's more to do.** An open PR is not a finished ticket. The PR
   follows the branch, so further commits on it — review fixes, remaining acceptance
   criteria, a red test — land in the same PR, one PR per ticket. The ticket stays
   `in_progress` throughout. Reword the description (`PATCH /api/prs/PR-n`) if the change
   grew.
4. **Mark the ticket `done`** (§5) only once the PR is open **and** the work is complete —
   acceptance criteria met, suite green. That PATCH is the last step. Under an
   orchestrator, the orchestrator marks it done after its spec check: your last step is
   the report back.

If the ticket turns out to need no code change (already fixed, invalid, investigation
only), there's nothing to merge: skip the PR — record why in the resolution
and mark it `done`.

Do **not** merge it yourself — the merge button is the human's. Merging moves the ticket
to `merged` and deletes the branch; a conflicted merge marks the PR `conflicted`, and the
fix is to rebase the ticket branch onto the integration branch and let them retry.

**A GITHUB PR** (they said "PR to master" / "PR to the integration branch") goes through
`gh` as before. List every ticket the branch closes in the body, by key and title with
its jTicket URL, and check that each of those tickets is recorded (§5) before you push:

```bash
git commit -m "TICK-7 feat(cart): persist across refresh"
gh pr create --title "TICK-7 Persist the cart across refresh" --body "$(cat <<'EOF'
Closes TICK-7 — Persist the cart across refresh
http://localhost:43000/tickets/TICK-7
EOF
)"
```

## 5. Record the outcome

Write the answer back **before** reporting to the user. The resolution is what a future
session reads instead of the diff. Anything that isn't the final answer — a question for
the human, a mid-flight progress note, why you're handing the ticket back — goes in a
**comment** under your own name:

```bash
jt comment TICK-7 "AC 2 can't be met as written — the cart API has no totals endpoint. Handing back."
```

```markdown
## What was built

<two or three lines: the shape of the change, in the domain's language>

## Where

- `path/to/thing.ts` — <what it does now>

## Notes

<decisions taken while building that a later ticket depends on; anything deferred>
```

```bash
jt set TICK-7 status=done resolution=@resolution.md assignee=claude
```

On the **local PR** path this PATCH comes **after** the PR is open (§4) — confirm it with
`jt prs ticket=TICK-7`
before sending `status:"done"`. Recording the resolution earlier is fine; send it without
`status` until the PR exists.

Only mark `done` when the acceptance criteria are actually met and the suite is green. If
they aren't, leave it `in_progress` — with its PR open, if you opened one — record what's
left in the resolution, and say so.

**Dispatched by jTicket's auto loop** (the hand-off says so): nobody is watching the pane,
and the loop waits on this ticket, so it always ends `done`. If the criteria can't be met,
record what's done and what's left in the resolution, file the remainder as a new AFK
ticket in the same project (§6), and mark this one `done` anyway. End the turn with the
ticket `done` and no question pending. A session that stops with the ticket open gets
prompted to finish, and then has the ticket closed for it.

## 6. Advance the board

Building always turns up more than the ticket held. Before reporting:

- **Work you deferred or discovered** → a new ticket in the same project, with `blockedBy`
  set to this one where it depends on it. Send only `tickets` in the import call and
  reference the project by key — import never upserts, so passing the project again duplicates it.
- **A ticket this work invalidated** → update its description, or close it and say why.
- Then confirm the frontier moved:

```bash
jt ls projectId=PROJ-2 --json \
  | jq '.[] | {key, title, status, blockedBy, blocked, frontier}'
```

Report back by **key and title** with the URL — `TICK-7 — Persist the cart` — plus what
the frontier is now. Then ask whether to take the next ticket; default to one ticket per
invocation rather than draining the project unasked.

## Gotchas

- **PATCH replaces arrays wholesale** — `blockedBy`, `labels`, `acceptanceCriteria`. Read,
  append, write back.
- **Refs resolve by id or key only** outside `/api/import` — a title in `blockedBy` or
  `projectId` is silently dropped, no error. GET it back and check.
- **`blocked` / `claimed` / `frontier` are derived on read.** Writing them does nothing.
- **Comments are append-only** — `POST /api/tickets/:id/comments` with
  `{ author, body }`; PATCHing `comments` does nothing. Discussion goes in comments, the
  final answer in `resolution`; anything longer becomes a doc (`POST /api/docs`) linked
  from it.
- **Deletes are unrecoverable** — the store is one JSON file. Delete only a ticket the user
  names by key; anything else you would remove, close with a resolution saying why.
- Other sessions may be working the same project in parallel. Re-read a ticket before
  patching it if time has passed since you loaded it.
