---
name: jimplement
description: Implement work that is already broken down as tickets in the local jTicket app — claim a ticket, build it, and record the outcome back on the board.
disable-model-invocation: true
---

# jImplement

`/implement`, driven by [jTicket](http://localhost:43000). The tickets are the spec: read
the work from the board, claim it before touching code, build it, and write the outcome
back so the next session — or another human — can see what happened without reading the
diff.

This skill **does** the work. If the way to the destination isn't clear yet — decisions
still open, questions to resolve — that's `/jwayfinder`, not this. If there's no
breakdown at all yet, that's `/to-jticket` in tickets mode first.

## Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If it is **down**, tell the user and stop — do not fall back to implementing from memory
or from files, and do not start the server yourself unless they ask. The start command is
`pnpm dev` in the jTicket repo (`~/code/jTicket`).

API reference: the `to-jticket` skill's [reference/api.md](../to-jticket/reference/api.md).
Markdown dialect for anything you write into a description or resolution: the `to-jspec`
skill, [SKILL.md](../to-jspec/SKILL.md).

## 1. Choose the ticket

The user invokes with a ticket key, an epic or project key, a name, or nothing at all.

```bash
# they named a ticket
curl -s "$JTICKET/api/tickets/TICK-7"

# they named an epic or project — take the first frontier ticket, in key order
curl -s "$JTICKET/api/tickets?epicId=EPIC-2&frontier=true" | jq '.[0]'

# they named nothing — show the board and ask which epic
curl -s "$JTICKET/api/projects"; curl -s "$JTICKET/api/epics"
```

The **frontier** is `todo` + unblocked + unclaimed, and jTicket computes it for you.
Never start a ticket whose `blocked` is `true` — its blockers hold facts you need. If the
frontier is empty but tickets remain, say so and stop; something is blocked or claimed.

A **HITL** ticket needs the human in the loop. Confirm they're here for it before
claiming, and never answer their side of it. **AFK** tickets you can take cold.

## 2. Claim it — before any work

Assignee first, so a concurrent session skips it. The assignee *is* the claim.

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-7" -H 'content-type: application/json' \
  -d '{ "assignee": "claude", "status": "in_progress" }'
```

## 3. Load the context

- The ticket's `description` (what to build) and `acceptanceCriteria` (when it's done).
- The ticket's `comments` — the human leaves direction there before handing a ticket
  over. A comment can narrow, extend, or override the description; if a comment and the
  description conflict, the newer comment wins (raise it if that's ambiguous).
- The `resolution` of every ticket in its `blockedBy` — that's where the decisions this
  ticket rests on were recorded.
- Any doc the description links (`GET /api/docs/DOC-n` → `.body`).

```bash
curl -s "$JTICKET/api/tickets/TICK-7" | jq '{title, description, acceptanceCriteria, blockedBy, comments}'
curl -s "$JTICKET/api/tickets/TICK-3" | jq -r '.resolution'
```

If the ticket contradicts the codebase, or the acceptance criteria can't be met as
written, **stop and raise it** rather than quietly reinterpreting the ticket. Record what
you found and hand it back (§6).

## 4. Build it

Standard `/implement` discipline, plus the project's own conventions — read the repo's
`CLAUDE.md`/`AGENTS.md` and invoke whatever skills it names for the layers you're
touching.

- Use `/tdd` where possible, at pre-agreed seams.
- Typecheck regularly; run single test files as you go; run the full suite once at the end.
- Scope the change to the ticket. Work you discover that belongs to a *different* ticket
  goes on the board (§6), not into this diff.
- Once done, use `/code-review` to review the work.

### Commits and the PR

Every commit subject **starts** with the key that owns the branch, so the board key is
readable from `git log`, from the PR list, and from a squashed merge subject:

- **A ticket branch** — one ticket's work — takes the **ticket** key:
  `TICK-7 feat(cart): persist across refresh`.
- **An integration branch** — the shared branch several tickets in an epic land on before
  a final integrate-and-verify — takes the **epic** key, or the **project** key when the
  branch spans epics: `EPIC-2 feat(cart): migrate the checkout call sites`.

The same prefix goes in the PR title, and it is the branch's prefix, not the prefix of
whichever ticket you happen to be on: opening a PR from an integration branch titled
`TICK-9 …` hides the fact that it carries the whole epic. Name the branch to match
(`tick-7-persist-cart`, `epic-2-cart-migration`).

Only open a PR when the user asks for one. When you do, list every ticket the branch
closes in the body, by key and title with its jTicket URL, and check that each of those
tickets is recorded (§5) before you push:

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
curl -s "$JTICKET/api/tickets/TICK-7/comments" -H 'content-type: application/json' \
  -d '{ "author": "claude", "body": "AC 2 can'\''t be met as written — the cart API has no totals endpoint. Handing back." }'
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
curl -s -X PATCH "$JTICKET/api/tickets/TICK-7" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" '{status:"done", resolution:$r, assignee:"claude"}')"
```

Only mark `done` when the acceptance criteria are actually met and the suite is green. If
they aren't, leave it `in_progress`, record what's left in the resolution, and say so.

## 6. Advance the board

Building always turns up more than the ticket held. Before reporting:

- **Work you deferred or discovered** → a new ticket in the same epic, with `blockedBy`
  set to this one where it depends on it. Send only `tickets` in the import call and
  reference the epic by key — import never upserts, so passing the epic again duplicates it.
- **A ticket this work invalidated** → update its description, or close it and say why.
- Then confirm the frontier moved:

```bash
curl -s "$JTICKET/api/tickets?epicId=EPIC-2" \
  | jq '.[] | {key, title, status, blockedBy, blocked, frontier}'
```

Report back by **key and title** with the URL — `TICK-7 — Persist the cart` — plus what
the frontier is now. Then ask whether to take the next ticket; default to one ticket per
invocation rather than draining the epic unasked.

## Gotchas

- **PATCH replaces arrays wholesale** — `blockedBy`, `labels`, `acceptanceCriteria`. Read,
  append, write back.
- **Refs resolve by id or key only** outside `/api/import` — a title in `blockedBy` or
  `epicId` is silently dropped, no error. GET it back and check.
- **`blocked` / `claimed` / `frontier` are derived on read.** Writing them does nothing.
- **Comments are append-only** — `POST /api/tickets/:id/comments` with
  `{ author, body }`; PATCHing `comments` does nothing. Discussion goes in comments, the
  final answer in `resolution`; anything longer becomes a doc (`POST /api/docs`) linked
  from it.
- **Deletes are unrecoverable** — the store is one JSON file. Never delete a ticket unless
  the user asks for that ticket by key.
- Other sessions may be working the same epic in parallel. Re-read a ticket before
  patching it if time has passed since you loaded it.
