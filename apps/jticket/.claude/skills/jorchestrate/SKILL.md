---
name: jorchestrate
description: Run one phase of a jTicket auto loop through implementer subagents, spec-checking and closing each ticket.
disable-model-invocation: true
argument-hint: "[PROJ-n orchestrator=N …]"
---

# jOrchestrate — one auto-loop phase, through subagents

jTicket's auto loop, in orchestrated mode, hands this session one phase's
tickets (implementing or fixing). You are the **orchestrator**: you run
implementer subagents, you gate each ticket on a **spec check**, and you mark
tickets done. You write no ticket code yourself. The loop is waiting on you,
so decide rather than ask: record each open question as a follow-up **HITL
ticket** in the project (the question, the ticket it came from, the options
you saw) and carry on with your best call.

Three rules hold for the whole run:

- **Every lane runs on its own.** A lane is one worktree slot and the ticket
  in it. Each lane is its own pipeline — claim → implement → spec-check →
  done → claim the next — and a lane never waits for another lane. When one
  implementer reports, its spec check starts then; when its verdict lands,
  its ticket is closed and that lane takes the next ticket then. The other
  lane keeps working through all of it. Never gather tickets into pairs or
  waves: an implementer that finishes first and sits unreviewed until its
  neighbour finishes is the single largest waste an orchestrator produces.
- **Every lane stays full.** The moment a lane frees, claim into it. With a
  budget of 2 you have two implementers running at every moment there are
  two claimable tickets. An orchestrator running one at a time costs more
  than the work it supervises.
- **The budget is the server's.** A ticket runs only once you claim it, and a
  claim past the budget is refused. The budget is never 1 and in a run plan
  it is 2 — a step runs at most 4 sessions at once, and an orchestrator counts
  as one of them whatever it has in flight. A ticket holds its budget share
  from claim to done, spec check included, so a lane claims its next ticket
  only after the previous one is marked done.

Subagents run **in the background**: every `Agent` call returns at once and
the agent's report comes back later as a task notification, in its own
message. Act on each notification by itself, as it arrives — that is what
makes the lanes independent. Between notifications you have nothing to do:
end your turn and wait. The loop's watchdog reads a session that is waiting
on running subagents as working, so waiting is safe; it is a session with
**no** subagent running and tickets still open that gets nudged, then
replaced. Never poll a subagent's output file or sleep in a loop to wait.

```bash
P=PROJ-2   # the project key you were invoked with
N=1        # which orchestrator you are, when the hand-off says "orchestrator N of M"; 1 when it doesn't
```

Every jTicket call goes through `jt` (on PATH after `./jsuite setup`; else
`bin/jt` in the jSuite checkout; `jt help`), never hand-built `curl` —
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

For each ticket not finished, read what you need to order them:

```bash
jt show TICK-7 | jq '{title, description, acceptanceCriteria, comments, blockedBy}'
```

Done when you know, for every open ticket, which parts of the code it touches.

## 2. Order the queue

Your tickets form **one ordered queue** that the lanes draw from. Order it,
don't group it:

- In-flight tickets from a previous orchestrator go first.
- Two tickets that touch the same files or module must not run at the same
  time: put them far enough apart in the queue that one is done before the
  other is claimed, or mark the later one "not beside TICK-n" and skip past
  it when its partner is still in a lane. That also spares the merge sweep a
  conflict.
- A heavy ticket (migration, whole-suite rework, dependency upgrade) runs
  alone: when a lane claims it, the other lane claims nothing new until it is
  done.
- Otherwise, shorter and lower-risk tickets first: a lane that frees early
  refills early.

Done when every open ticket has a place in the queue. Re-order whenever a
subagent reports overlap you didn't foresee.

## 3. Set up the lanes

A **lane's slot** is a worktree you create once and reuse for ticket after
ticket, so dependencies install once per slot rather than once per ticket.
Make exactly `budget` slots (two, in a run plan).

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

## 4. Fill a lane

Do this for every free lane — both of them at the start, and one lane at a
time after that, each time a lane frees. Launch the implementers for two
free lanes in the same message; never hold one back to pair it with a later
one.

1. **Claim the next ticket in the queue that may run now** (not a "not
   beside" partner of a ticket in the other lane; nothing, while a heavy
   ticket is in the other lane).

   ```bash
   jt claim $P TICK-7 orchestrator=$N
   # → { ticket, title, branch, integrationBranch, prompt, again, inFlight, budget,
   #     orchestrator, orchestrators, subagentModel, subagentEffort, sliceDoc }
   ```

   Exit 75 (a 409 with `data.wait: true`) means the budget is full — or, in a run plan,
   the ticket is still blocked or claimed by hand: try the next ticket in the
   queue, and come back to this one the next time a lane frees. Any other
   refusal means the ticket is no longer yours to run — take it out of the queue.

2. **Point the lane's slot at its branch**: `git -C <slot> status --porcelain`
   prints nothing, then `git -C <slot> switch <branch>`.

3. **Launch its implementer**: one `Agent` call, `model: "<subagentModel>"`,
   `effort: "<subagentEffort>"`, `description: "Implement TICK-7 in lane A"`, prompt:

   > You are implementing TICK-7. Your worktree is `<slot path>`, with branch
   > `<branch>` checked out — work only there, using absolute paths. Read
   > `<jsuite root>/apps/jticket/.claude/skills/jimplement/SKILL.md` and follow
   > it with this hand-off: `<prompt from the claim>`

   Fill `<jsuite root>` with what `jsuite root` prints. jimplement is typed-only,
   so a subagent cannot invoke it as a skill; reading the file gives it the
   same steps.

   It reports back, later, with its PR key, what it built, and anything left
   undone.

Then end your turn. The next thing that happens is a report arriving.

## 5. When a report arrives

Each task notification is one lane's news. Handle that lane and only that
lane, in the same turn, then end the turn again. Do not look across at the
other lane; if its report has not arrived, it is still working.

**An implementer reported** → launch that ticket's spec reviewer now — one
`Agent` call, `model: "<subagentModel>"`, `effort: "<subagentEffort>"`:

> Spec-review TICK-7. Diff: `git -C <repo> diff <integrationBranch>...<branch>`
> (commits: `git -C <repo> log <integrationBranch>..<branch> --oneline`). Spec:
> `jt show TICK-7 | jq '{description, acceptanceCriteria, comments}'`
> — the newer comment wins where one contradicts the description. Report:
> (a) acceptance criteria missing or partial; (b) behaviour in the diff nobody
> asked for; (c) criteria that look implemented but wrongly. Quote the
> criterion for each finding. End with one line: `VERDICT: PASS` or
> `VERDICT: FAIL`. Under 300 words.

The lane stays claimed through the review (the budget counts it), so nothing
else is launched for this lane yet.

**A spec reviewer reported** → close the ticket out, then refill the lane:

- **PASS** — check the PR exists
  (`jt prs ticket=TICK-7 status=open` is non-empty), **release the slot**
  (`git -C <slot> switch --detach`), then mark it done:
  `jt set TICK-7 status=done`. The merge sweep deletes each ticket branch
  after merging it, which git refuses while a worktree has that branch checked
  out — so the detach always comes before the done.
- **FAIL** — send the findings back to the same implementer (`SendMessage` to
  its agent; if it's gone, a fresh implementer on the same slot and branch).
  Its next report is handled as an implementer report again. After **two**
  failed fix rounds, stop retrying: write what's done and what's left into the
  ticket's resolution, file the remainder as a new AFK ticket in the project,
  release the slot, and mark it done.
- **No code change needed** (already fixed, invalid) — the implementer
  recorded why in the resolution; there's no PR to check. Release the slot and
  mark it done.

Then, **in the same turn**, go straight back to §4 for this lane: claim the
next runnable ticket and launch its implementer. If nothing is claimable
right now (budget full, every remaining ticket blocked or a "not beside"
partner of the other lane's ticket), the lane waits for the other lane's next
report, and you try again then.

**Two reports in one notification** → handle both lanes in that turn, each as
above. Still no pairing: each lane's next step depends on its own report only.

## 6. Finish

You are finished when the queue shows every ticket you can claim `finished`
(`human` ones are the human's, `solo` ones the loop's own agents', `other`
ones another orchestrator's — not yours to wait on) and no lane has a subagent
running:

```bash
jt queue $P orchestrator=$N | jq '[.tickets[] | select(.state != "finished" and .state != "human" and .state != "other" and .state != "solo")] | length'   # 0
```

Then tear every slot down the way the guide says (`git worktree remove`
last) — forced, since every ticket's commits are on its branch and anything
left in a slot is disposable — and end with a short summary: tickets done, PR
keys, carryover tickets filed, and the path of any slot you could not remove.
The loop moves on to the merge sweep once every ticket is done.
