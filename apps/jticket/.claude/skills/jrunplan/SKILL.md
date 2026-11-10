---
name: jrunplan
description: Build a jTicket project's run plan — read the project, its docs, every open ticket and the code, weigh each ticket, decide who runs what on which model and effort, and place merges, reviews and gates sparingly; save it through the run-plan API until it has no problems, then report back. Invoked as "/jrunplan [PROJ-n]" by the Run setup tab's Build button (one Fable 5.2 session at high effort). Not for general use.
disable-model-invocation: true
argument-hint: "[PROJ-n]"
---

# jRunPlan — build the run plan

jTicket's Run setup tab handed you a project. You write its **run plan**: the
ordered steps auto mode walks — which tickets run together, who runs each
(its own agent, or an orchestrator working a group through subagents), on
which model at which effort, and where merges, reviews and gates go. The
human reads the plan on the board and presses Start; you don't run anything.
Nobody is watching your pane: decide rather than ask. The plan is done only
when `PUT …/run-plan` answers `problems: []` and you have reported back (§5).

```bash
P=PROJ-2   # the project key you were invoked with
```

Every jTicket call goes through `jt` (on PATH after `./jsuite setup`; else
`bin/jt` in the jSuite checkout; `jt help`), never hand-built `curl`.

## 1. Read everything the plan rests on

```bash
jt project $P | jq '{key, title, description, repo, integrationBranch, runPlan}'
jt get "/api/docs?projectId=$P" | jq '[.[] | {key, title, documentKey, labels, status}]'     # specs, slice reports, outcome reports
jt ls projectId=$P --json | jq '[.[] | select(.status != "done" and .status != "merged") | {key, title, type, labels, status, blockedBy, acceptanceCriteria, description}]'
```

A doc's record carries only metadata; read its content with
`jt get /api/documents/<documentKey>`. `blockedBy` holds ticket **ids**; map
them to keys with the full list (`jt ls --json | jq 'map({(.id): .key}) | add'`). A ticket
labelled `hitl` is the human's; `paused` is parked; everything else is AFK —
yours to place.

You are cd'd into the repo. For each open ticket, find the code it touches
(`grep`, `git log -- <path>`, the files its description names) so you know
which tickets share an area and how heavy each is. Read the spec docs the
project links; a slice report from an earlier run says what already exists.

Done when, for every open AFK ticket, you can say: its weight, its area, its
open blockers, and what it unblocks.

## 2. Weigh the work

There is no size field — you judge. Signals: acceptance-criteria count and
specificity, the description's reach, type (`bug`/`docs` tend light,
`story` heavy), how many files and modules the area spans, whether it
changes a contract others build on, whether tests exist around it.

| Weight | Looks like | Runs as |
| --- | --- | --- |
| light | a one-file fix, a doc, a rename, a copy change, a test gap | grouped under an orchestrator — Sonnet 5.5 or Haiku 5.5, `low`/`medium` |
| medium | a feature inside one module, a bug with a clear repro | grouped under an orchestrator on Opus 5.5 `medium`/`high`, or its own agent |
| heavy | a new module, a migration, a cross-cutting contract change, anything with design in it | its own agent — Opus 5.5 `high` (Fable 5.2 `high` only when it needs real judgment) |

Orchestrators pay off on **four or more related small or medium tickets**: one
Fable 5.2 session shares worktree slots, runs them through subagents (2 at
once) and spec-checks each. A heavy ticket alone gains nothing from one, and
neither does a box of two or three: measured over a real run, every
orchestrator that had one subagent going at a time cost more than the work it
supervised and sat idle most of its wall clock. Fewer than four → own agents.
Two groups may run side by side in one step — a box of light tickets on a
cheap runner beside a box of medium ones — each group carrying its own model
and effort (`groupRunners`). Keep one orchestrator's share to roughly eight
tickets at most; a longer list is split over consecutive steps.

## 3. Shape the steps

- **Implement steps** hold tickets that can run side by side: disjoint areas,
  no open blocker among them.
- **Concurrency rule — at most 4 sessions at once in a step.** Too many
  sessions at once slow every one of them down. An orchestrator counts as one
  session whatever its budget, and each orchestrator works 2 tickets at once
  (`budget` is always 2 — a 1 is lifted to 2 on save; one subagent at a time
  is pure overhead). An implement step takes one of three shapes:

  | Shape | Own-agent tickets running | Orchestrators |
  | --- | --- | --- |
  | own agents only | up to 4 at once | 0 |
  | mixed | up to 3 at once | 1 |
  | orchestrators only | none — not one solo ticket | 2 |

  Never more than 2 groups in a step; with 2 groups, every ticket of the step
  is in one of them (the validator refuses a solo ticket beside two
  orchestrators; a third group is folded into the second on save; a budget
  over 2 is clamped).
- **A group needs four or more tickets.** Fewer is a `problems` entry: run
  them as own agents instead (a step of 3 own agents is cheaper and faster
  than an orchestrator over the same 3). If some of a group's tickets are
  already finished when the step starts, the engine counts what is left and
  runs a group that has shrunk under four as own agents — so size groups by
  the work that will actually be open when the step runs.
- **A step is a queue.** It may hold more tickets than it can run at once:
  `tickets` is the dispatch order, and the engine starts the next own-agent
  ticket as a session frees (the 5th of five solo tickets starts when one of
  the first four finishes; beside an orchestrator, the 4th starts when one of
  the first three does). **You choose the order** — that is the ordering
  rule, and it is yours, not a fixed "own agents first": put the heavy or
  long-running tickets first so they don't tail the step, the ones whose
  area the others touch least last, and the step's orchestrator group where
  you like. Dependencies never ride on queue order: an open blocker still
  needs its own earlier step with a merge between (next bullet).
- **Blockers**: a ticket's open blocker must sit in an **earlier** implement
  step with a **merge** step between them — the validator refuses anything
  else. Layer the blocker graph: everything unblocked first, then what it
  frees, a merge between each layer.
- **Merge** after every implement step whose work a later step builds on,
  and before every review (a review reads the integration branch).
- **Reviews are for drift and breakage, not polish.** Reviewing after every
  step breeds out-of-scope work. Guidance, not law — scale it to the project:
  on a large board, two or three implement steps and roughly ten landed
  tickets between reviews; on a small one, a single review at the end is
  right. Always end the plan with a review when anything was implemented.
  Reviewer count 2 (3–4 only for a slice where disagreement is likely).
  Pick the reviewers' effort by how technical the slice was: `low`/`medium`
  for routine work, `high` for a slice that changed contracts or concurrency.
  Turn on the architectural pass (`review.arch`) only after a slice that
  introduced or reshaped a module boundary.
- **HITL tickets** are never dispatched: the step waits for the human. Put
  them in their own implement step **followed by a gate**, so the human sees
  the pause — or leave them out and say so in your closing line. Paused
  tickets stay out.
- **Gates** only where a human must look before the plan goes on (a
  migration landed, a HITL decision). Not between every step.

## 4. Write the plan

The body is `{ "steps": [...] }`. Every step has `id` (`s1`, `s2`, …, unique)
and `kind`; the rest by kind:

```jsonc
{ "id": "s1", "kind": "implement",                           // MIXED: 1 orchestrator + own agents, 3 of them at once
  "tickets": ["TICK-12", "TICK-13", "TICK-14", "TICK-15", "TICK-7", "TICK-8", "TICK-9", "TICK-10"],   // the QUEUE — own agents start in this order
  "dispatch": { "mode": "orchestrated", "model": "opus", "effort": "high", "budget": 2, "orchestrators": 1 },
  "groups": [["TICK-7", "TICK-8", "TICK-9", "TICK-10"]],   // the orchestrator's group: 4+ tickets, budget 2
  "groupRunners": [{ "model": "sonnet", "effort": "low" }], // per group; null = the step's dispatch
  "runners": { "TICK-12": { "model": "fable", "effort": "high" } }   // a solo ticket's own model/effort
  // TICK-12, -13, -14 start with the orchestrator; TICK-15 starts when one of them finishes
}
{ "id": "s2", "kind": "implement",                           // ORCHESTRATORS ONLY: two groups, nothing solo beside them
  "tickets": ["TICK-20", "TICK-21", "TICK-22", "TICK-23", "TICK-24", "TICK-25", "TICK-26", "TICK-27"],
  "dispatch": { "mode": "orchestrated", "model": "opus", "effort": "medium", "budget": 2, "orchestrators": 2 },
  "groups": [["TICK-20", "TICK-21", "TICK-22", "TICK-23"], ["TICK-24", "TICK-25", "TICK-26", "TICK-27"]],   // 4+ each
  "groupRunners": [{ "model": "haiku", "effort": "low" }, null]
}
{ "id": "s6", "kind": "implement",                           // OWN AGENTS ONLY: 4 at once, the 5th queued
  "tickets": ["TICK-30", "TICK-31", "TICK-32", "TICK-33", "TICK-34"],
  "dispatch": { "mode": "sessions", "model": "opus", "effort": "high", "budget": 2, "orchestrators": 1 },
  "groups": []
}
{ "id": "s3", "kind": "merge" }
{ "id": "s4", "kind": "review", "reviewers": 2, "base": "",       // "" = since the previous review or plan start; "start"; or an earlier step id
  "review": { "model": "opus", "effort": "medium", "arch": null } } // arch: null, or { "model", "effort" } for the architectural pass first
{ "id": "s5", "kind": "gate", "note": "check the migration on staging" }
```

Models: `opus`, `sonnet`, `haiku`, `fable`. Efforts: `low`, `medium`,
`high`, `xhigh`, `max`. `mode` follows the groups (any group → orchestrated).
A step without `dispatch` runs on the run's default (Opus 5.5 high) — set it
on every implement step instead, so the board says what you decided.

```bash
jt put /api/projects/$P/run-plan @plan.json | jq '.problems'
```

The answer's `problems` are what would stop the plan running (a blocker in
the wrong step, a missing merge, a ticket from another project, a solo ticket
beside two orchestrators, a group of fewer than four tickets). The rest of the
concurrency rule is applied on save (groups folded to 2, budget set to 2) and the queue is enforced by
the engine — so a step with more tickets than sessions is fine, and the order
you PUT is the order they start. Fix and PUT again until it is `[]`. The draft
saves each time, so the human sees
the board fill. A finished ticket (`done` with its PR open, or `merged`) may
stay in a step: the engine skips it, and a done one's PR is swept by the next
merge — so don't rebuild a plan just because part of it already ran.

## 5. Report back — last

```bash
jt post /api/projects/$P/run-plan/built '{"summary": "<one line: N steps, how the reviews are placed, anything left out>"}'
```

This unlocks the tab. Then reply with a few lines — the steps in order, each
with its shape (own agents / mixed / two orchestrators), who runs what and
why that weight, and why the queue is in that order — and stop. Don't start
the plan; that's the human's button.
