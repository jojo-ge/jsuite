---
name: jreproduce
description: Reproduce one suspected bug from a predeploy-mode jTicket project — in a throwaway worktree, as a failing test — and record the test, the failure and the verdict back on the ticket without fixing anything. Use when "/jreproduce <TICK-n>" is invoked (jTicket dispatches these into herdr from a predeploy board).
disable-model-invocation: true
---

# jReproduce — prove the bug, don't fix it

You were dispatched from a **predeploy-mode** jTicket project: a board of
suspected bugs standing between a codebase and a deploy. Each ticket is one
report. Your job is to find out whether it is **real**, encode it as a **test
that fails for the bug's reason**, and write that test plus the verdict onto the
ticket — so the human can decide what blocks the deploy without reading a diff
or re-running your session.

You do **not** fix anything. The reproduction happens in a git worktree you
create and delete; nothing you write survives in the repo. The failing test
survives on the ticket.

Invocation: `/jreproduce <TICK-n>`

## 0. Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If jTicket is down: say so (`./jsuite start` from the jsuite repo) and STOP. Do
not reproduce from memory — without the board there is nowhere to record the
finding, which is the entire deliverable.

API reference: the `to-jticket` skill's [reference/api.md](../to-jticket/reference/api.md).
Markdown dialect for anything you write into a resolution or doc: the `to-jspec` skill.

## 1. Read the report cold

```bash
curl -s "$JTICKET/api/tickets/TICK-n" | jq '{title, description, acceptanceCriteria, labels, comments, projectId}'
curl -s "$JTICKET/api/projects/<PROJ-key>" | jq '{title, repo, integrationBranch, description}'
```

- The `description` is the human's report — **never edit it**. It is the claim
  you are testing.
- The `comments` narrow it: a version, a repro path, "only on staging". A newer
  comment beats the description where they conflict.
- Any doc the description links (`GET /api/docs/DOC-n` → `.body`).

Before touching the repo, write down — for yourself — the **observable** the
report is really about: an input, an action, and the wrong output. If the report
has no observable ("feels slow", "checkout is broken"), that is your first
finding: ask the human in this pane for the one missing detail, or record
`unclear` (§5) rather than guessing which bug they meant.

## 2. Claim it — before any work

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d '{ "assignee": "claude", "status": "in_progress" }'
```

## 3. Cut a throwaway worktree

The repo's own checkout is the human's, and a predeploy sweep may be running
several of these at once. Work in a worktree of your own, detached at a commit
you name in the finding — a reproduction against "whatever was checked out" is
not a reproduction.

```bash
REPO="<project.repo>"                       # from §1
BASE="<project.integrationBranch or the repo's default branch>"
SHA="$(git -C "$REPO" rev-parse "$BASE")"
WT="$(mktemp -d)/TICK-n"
git -C "$REPO" worktree add --detach "$WT" "$SHA"
cd "$WT" && <install deps the way this repo does — pnpm i / npm ci / …>
```

Read the repo's `CLAUDE.md`/`AGENTS.md` for how it runs tests, and use whatever
skills it names. Everything from here happens inside `$WT`.

## 4. Reproduce it — as a failing test

Reproduce by hand first if that is faster, but the deliverable is a test.

- **Tightest layer that still shows the bug.** A unit test beats an integration
  test beats an e2e test: it names the broken behavior instead of a symptom.
  Go wider only when the bug lives in the wiring.
- **Assert the correct behavior**, not the buggy one — the test is written to be
  green after a fix, and handed to whoever writes it.
- **Run it and read the failure.** A test that fails on a typo, a missing
  fixture, or an import error has reproduced nothing. The failure message must
  name the actual wrong value or the actual thrown error.
- **Control the experiment.** A failing test alone doesn't prove the bug —
  it might just be a wrong test. Prove the test is sound: check it passes
  against the behavior everyone agrees is correct (an adjacent case that works,
  the commit before the suspected regression via `git log -S` / `git bisect`,
  or the same assertion on a sibling code path).
- **Run it at least twice.** Intermittent failures are a different finding (§5)
  and the human needs the rate, not the anecdote.
- **Time-box it.** Say up front how long you'll spend (30 minutes of honest
  effort is a reasonable default). Not reproducing is a legitimate, useful
  result — it is not a failed session, and it must not turn into a fishing trip.

Follow leads with `/diagnosing-bugs` if the observable is there but the cause
isn't. Stop at the point where you can *name* where the bug lives — that is the
edge of this job.

## 5. Land on a verdict

Exactly one, and say it in the first line of the resolution:

| Verdict | What it means |
| --- | --- |
| `reproduced` | The test fails at `SHA`, deterministically, for the reported reason |
| `flaky` | It reproduces intermittently — record the rate (`7/20 runs`) and what changes between runs |
| `not-reproduced` | The reported behavior doesn't happen at `SHA`. Say what you saw instead, and what you tried |
| `already-fixed` | Reproduces at the reported version, not at `SHA` — name the commit that fixed it |
| `invalid` | The system behaves as designed; name the rule or test that says so |
| `unclear` | The report doesn't pin an observable, and the human hasn't supplied it |
| `blocked` | Couldn't stand the environment up (missing service, secret, fixture) — say exactly what stopped you |

Then answer the question the board exists for: **does this block the deploy?**
yes / no / human's call, in one line with your reason. That is a
recommendation, not a decision — you never change the deploy plan yourself.

## 6. Record it on the ticket

The test does **not** get committed — the worktree is about to be deleted. It
lives in the resolution, paste-ready: full file path, imports included, plus the
exact command that runs it.

````markdown
## Verdict

**reproduced** — at `a1b2c3d` (`main`). Blocks the deploy: **yes** — every
guest checkout loses the cart.

## What happens

<observed vs expected in the domain's language: the input, the action, the
wrong output. Two or three lines.>

## The failing test

`packages/cart/src/cart.test.ts` — new file. Run: `pnpm vitest run packages/cart/src/cart.test.ts`

```ts
<the test, verbatim and complete — imports, fixtures, assertions>
```

## Failure output

```
<the trimmed real output — the assertion diff or the stack's top frames>
```

## Where it lives

- `packages/cart/src/store.ts:88` — <what the test bottoms out on>. Suspicion,
  not a diagnosis: <what would confirm it>.

## Notes

<the control experiment and what it showed; flakiness rate; environment needed;
what a fix must not break; anything the report claimed that you could NOT
confirm.>
````

More than one test, or a repro that needs a fixture dump? Publish it as a doc on
the project and link it from the resolution:

```bash
curl -s -X POST "$JTICKET/api/docs" -H 'content-type: application/json' -d @- <<'JSON'
{ "title": "TICK-n — <bug title> — reproduction", "project": "<PROJ-key>",
  "labels": ["predeploy", "predeploy:repro", "TICK-n"], "status": "draft", "kicker": "REPRO", "blocks": [ … ] }
JSON
```

Write the ticket back — `done` for every verdict except `blocked`/`unclear`
(those stay `in_progress`, waiting on the human). Labels are replaced wholesale
by PATCH, so read them first and append:

```bash
LABELS="$(curl -s "$JTICKET/api/tickets/TICK-n" | jq -c '.labels + ["predeploy:reproduced"] | unique')"
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" --argjson l "$LABELS" \
        '{status:"done", resolution:$r, labels:$l, assignee:"claude"}')"
```

Anything that isn't the finding — a question for the human, a mid-flight note —
goes in a comment (`POST /api/tickets/TICK-n/comments`), never in the description.

## 7. Tear the worktree down — always

Success, failure, or abandoned. Leaving worktrees behind poisons the next
reproduction and the human's own repo.

```bash
git -C "$REPO" worktree remove --force "$WT" && git -C "$REPO" worktree prune
git -C "$REPO" worktree list      # yours is gone
git -C "$REPO" status --short     # the human's checkout, untouched
rm -rf "$(dirname "$WT")"
```

If teardown fails, say so loudly in your report with the path — a stranded
worktree is the one thing here a human must clean up by hand.

## 8. Report back

One line per: `TICK-n — <title>` with its URL, the verdict, whether it blocks the
deploy, and where the test is. Then stop. **Do not** take the next ticket unless
asked — a predeploy board is dispatched a ticket at a time on purpose.

## Never

- **Never fix the bug.** No source edits at all: the only file you write is the
  test, in the worktree, and it dies with the worktree.
- Never commit, cut a branch, push, or open a PR. Nothing leaves the machine.
- Never leave the worktree behind (§7), and never work in the repo's own checkout.
- Never call something reproduced without a test you ran and watched fail —
  "I read the code and it looks wrong" is a suspicion, and belongs under **Where
  it lives**, not in the verdict.
- Never edit the ticket's description; the report is the human's.
- Never open a fix ticket, a project, or a PR off the back of the finding unless
  the human asks. The resolution IS the hand-off — `/jimplement` picks it up
  from there.
