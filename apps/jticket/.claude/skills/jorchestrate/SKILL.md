---
name: jorchestrate
description: Run one phase of an orchestrated jTicket auto loop — plan which tickets run side by side and which in sequence, implement each through a subagent (on the model the hand-off names — Opus by default) in a pooled worktree, spec-check every ticket against its acceptance criteria, and mark it done. Invoked as "/jorchestrate [PROJ-n] orchestrator=N …" by jTicket's auto loop and run plans; not for general use.
disable-model-invocation: true
argument-hint: "[PROJ-n orchestrator=N …]"
---

# jOrchestrate — one auto-loop phase, through subagents

jTicket's auto loop, in orchestrated mode, hands this session one phase's
tickets (implementing or fixing). You are the **orchestrator**: you plan, you
run implementer subagents, you gate each ticket on a **spec check**, and you
mark tickets done. You write no ticket code yourself. The loop is waiting on
you, so decide rather than ask: record each open question as a follow-up
**HITL ticket** in the project (the question, the ticket it came from, the
options you saw) and carry on with your best call.

Two rules hold for the whole run:

- **Stay in your turn while subagents work.** Launch each wave's subagents in
  one message so your turn waits on them. The loop reads a stopped session
  as stalled: it prompts you once, then replaces you.
- **The budget is the server's.** A ticket runs only once you claim it, and a
  claim past the budget is refused. Your plan fits under it. In a run plan
  the budget is at most 2 — a step runs at most 4 sessions at once, and an
  orchestrator counts as one of them whatever it has in flight.

```bash
P=PROJ-2   # the project key you were invoked with
N=1        # which orchestrator you are, when the hand-off says "orchestrator N of M"; 1 when it doesn't
```

Every jTicket call goes through `jt` (on PATH after `./jsuite setup`; else
`~/code/jsuite/bin/jt`; `jt help`), never hand-built `curl` —
in your own calls and in every prompt you hand a subagent. `jt claim` exits **75**
when the budget is full.

Several orchestrators may run this phase side by side, each with its own
share of the tickets. Your hand-off says which you are (`orchestrator N of
M`) — pass `orchestrator=$N` to `jt queue` and every `jt claim`, and work only
the tickets the queue lists as yours.

## 1. Read the queue and every ticket

```bash
jt queue $P orchestrator=$N
# → { project, loop, phase, budget, subagentModel, subagentEffort, sliceDoc, orchestrator, orchestrators,
#     repo, integrationBranch, inFlight, tickets: [{key, title, status, branch, orchestrator, state}] }
```

`budget` and `inFlight` are yours alone — each orchestrator has its own
budget. `sliceDoc`, when set, is the slice report (DOC-n) for this step —
read it first: `/api/docs/DOC-n` is only the tracker record, the content is
`jt get /api/documents/$(jt get /api/docs/DOC-n | jq -r .documentKey)` —
what the previous slice built and decided. Every claim's prompt tells the
implementer to read it too.

`subagentModel` and `subagentEffort` are the model and effort every subagent
you launch runs on — the `model` and `effort` of each `Agent` call below
(`opus`, `sonnet`, `haiku` or `fable`; `low` … `max`; the human picked them
for this phase). Your hand-off names them too; use `opus` and `high` if
neither does. The orchestrator — you — stays whatever it was started as.

`state` is `waiting` (yours to claim), `in-flight` (claimed — after a restart,
a previous orchestrator's; its branch may carry partial work), `human` (a HITL
or `paused`-labelled ticket in a run plan's step — never claim it; the human
works it and the loop waits for them), `solo` (the loop runs it as its own agent beside you — not
yours; never claim it or wait on it), `other` (another orchestrator's — not
yours either), or `finished`.

For each ticket not finished, read what you need to plan:

```bash
jt show TICK-7 | jq '{title, description, acceptanceCriteria, comments, blockedBy}'
```

Done when you know, for every open ticket, which parts of the code it touches.

## 2. Plan the waves

A **wave** is the set of tickets running at once — never more than `budget`.

- Tickets in disjoint areas share a wave.
- Tickets that touch the same files or module run in sequence: same area,
  different waves. That also spares the merge sweep a conflict.
- A heavy ticket (migration, whole-suite rework, dependency upgrade) runs alone.
- In-flight tickets from a previous orchestrator go in the first wave.

Done when every open ticket sits in a wave. Revise the plan whenever a
subagent reports overlap you didn't foresee.

## 3. Set up worktree slots

A **slot** is a worktree you create once and reuse for ticket after ticket,
so dependencies install once per slot rather than once per ticket. Make only
as many slots as your widest wave.

Get the codebase's worktree guide and follow it for creating, setting up and
tearing down (the `/jimplement` skill, §4, covers `ready` / `stale` / `missing`):

```bash
REPO="$(jt queue $P orchestrator=$N | jq -r .repo)"
jt get "/api/repos/worktree?repo=$(jq -rn --arg r "$REPO" '$r|@uri')" | jq '{state, changed, body: .guide.body}'
```

Create each slot detached (`git worktree add --detach <path>`) so no ticket
branch is pinned to it, then run the guide's setup there. Where the guide
offers a cheap slim/test-only form (tests, lint and typecheck without the
app), that is the slot's form; the guide's pooled-worktree section says how a
slot takes ticket after ticket. Promote a slot to the full form only for a
ticket that needs the app.

## 4. Run a wave

For each ticket in the wave:

1. **Claim it.**

   ```bash
   jt claim $P TICK-7 orchestrator=$N
   # → { ticket, title, branch, integrationBranch, prompt, again, inFlight, budget,
   #     orchestrator, orchestrators, subagentModel, subagentEffort, sliceDoc }
   ```

   Exit 75 (a 409 with `data.wait: true`) means the budget is full — or, in a run plan,
   the ticket is still blocked or claimed by hand: run the rest of the wave
   first and claim it again after. Any other refusal means the ticket is no longer yours to run
   — take it out of the plan.

2. **Point a free slot at its branch**: `git -C <slot> status --porcelain`
   prints nothing, then `git -C <slot> switch <branch>`.

3. **Launch its implementer**: an `Agent` call, `model: "<subagentModel>"`, `effort: "<subagentEffort>"`, prompt:

   > You are implementing TICK-7. Your worktree is `<slot path>`, with branch
   > `<branch>` checked out — work only there, using absolute paths. Invoke the
   > `jimplement` skill with this hand-off: `<prompt from the claim>`

Launch all of the wave's implementers in one message. Each reports back
with its PR key, what it built, and anything left undone.

## 5. Spec-check every ticket

A ticket leaves the wave only through the **spec check**. For each
implementer that reported, launch a spec reviewer — `Agent`, `model: "<subagentModel>"`, `effort: "<subagentEffort>"` —
all of the wave's reviewers in one message:

> Spec-review TICK-7. Diff: `git -C <repo> diff <integrationBranch>...<branch>`
> (commits: `git -C <repo> log <integrationBranch>..<branch> --oneline`). Spec:
> `jt show TICK-7 | jq '{description, acceptanceCriteria, comments}'`
> — the newer comment wins where one contradicts the description. Report:
> (a) acceptance criteria missing or partial; (b) behaviour in the diff nobody
> asked for; (c) criteria that look implemented but wrongly. Quote the
> criterion for each finding. End with one line: `VERDICT: PASS` or
> `VERDICT: FAIL`. Under 300 words.

Then, per ticket — and before marking any ticket done, **release its slot**
(`git -C <slot> switch --detach`): the merge sweep can start the moment the
last ticket is done, and it deletes each ticket branch after merging it, which
git refuses while a worktree has that branch checked out.

- **PASS** — check the PR exists
  (`jt prs ticket=TICK-7 status=open` is non-empty), then
  mark it done:
  `jt set TICK-7 status=done`
- **FAIL** — send the findings back to the same implementer (`SendMessage` to
  its agent; if it's gone, a fresh implementer on the same slot and branch)
  and spec-check again once it reports. After **two** failed fix rounds, stop
  retrying: write what's done and what's left into the ticket's resolution,
  file the remainder as a new AFK ticket in the project, and mark it done.
- **No code change needed** (already fixed, invalid) — the implementer
  recorded why in the resolution; there's no PR to check. Mark it done.

A released slot takes the next ticket. Done when every ticket of the wave is
`done`.

## 6. Next wave, then finish

Repeat 4–5 until the queue shows every ticket you can claim `finished`
(`human` ones are the human's, `solo` ones the loop's own agents', `other`
ones another orchestrator's — not yours to wait on):

```bash
jt queue $P orchestrator=$N | jq '[.tickets[] | select(.state != "finished" and .state != "human" and .state != "other" and .state != "solo")] | length'   # 0
```

Then tear every slot down the way the guide says (`git worktree remove`
last) — forced, since every ticket's commits are on its branch and anything
left in a slot is disposable — and end with a short summary: tickets done, PR
keys, carryover tickets filed, and the path of any slot you could not remove.
The loop moves on to the merge sweep once every ticket is done.
