---
name: jrunplan
description: Build a jTicket project's run plan — read the project, its docs, every open ticket and the code, weigh each ticket, decide who runs what on which model and effort, and place merges, reviews and gates sparingly; save it through the run-plan API until it has no problems, then report back. Invoked as "/jrunplan [PROJ-n]" by the Run setup tab's Build button (one Fable 5.1 session at high effort). Not for general use.
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
`~/code/jsuite/bin/jt`; `jt help`), never hand-built `curl`.

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
| heavy | a new module, a migration, a cross-cutting contract change, anything with design in it | its own agent — Opus 5.5 `high` (Fable 5.1 `high` only when it needs real judgment) |

Orchestrators pay off on **several related small or medium tickets**: one
Fable 5.1 session shares worktree slots, runs them through subagents and
spec-checks each. A heavy ticket alone gains nothing from one. A group of
light tickets runs cheap in its own step and a group of medium ones in the
next — each group carries its own model and effort (`groupRunners`). Keep one
orchestrator's share to roughly eight tickets at most; a longer list is split
over consecutive steps.

## 3. Shape the steps

- **Implement steps** hold tickets that can run side by side: disjoint areas,
  no open blocker among them.
- **Concurrency cap: one orchestrator at a time, at most 2 tickets in
  flight.** Too many sessions at once slow every one of them down. Every
  implement step is EITHER one orchestrator group (`budget` 1 or 2, no solo
  ticket beside it) OR at most 2 solo tickets (no group). Never two groups in
  a step, never a group beside a solo. Work that would have run as several
  groups side by side becomes consecutive implement steps instead (no merge
  is needed between them unless a blocker says so); a group with its own
  runner is its own step. The engine would accept up to 4 groups × 4 in
  flight — don't.
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
{ "id": "s1", "kind": "implement",
  "tickets": ["TICK-7", "TICK-8", "TICK-9"],
  "dispatch": { "mode": "orchestrated", "model": "opus", "effort": "high", "budget": 2, "orchestrators": 1 },
  "groups": [["TICK-7", "TICK-8", "TICK-9"]],              // ONE orchestrator group holding every ticket of the step; budget ≤ 2
  "groupRunners": [{ "model": "sonnet", "effort": "low" }]  // per group; null = the step's dispatch
}
{ "id": "s2", "kind": "implement",
  "tickets": ["TICK-12", "TICK-13"],                         // solo tickets: at most 2 in a step, and no group beside them
  "dispatch": { "mode": "sessions", "model": "opus", "effort": "high", "budget": 2, "orchestrators": 1 },
  "groups": [],
  "runners": { "TICK-12": { "model": "fable", "effort": "high" } }   // a solo ticket's own model/effort
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
the wrong step, a missing merge, a ticket from another project). The
concurrency cap in §3 is yours to keep — the validator does not check it. Fix
and PUT again until it is `[]`. The draft saves each time, so the human sees
the board fill. A finished ticket (`done` with its PR open, or `merged`) may
stay in a step: the engine skips it, and a done one's PR is swept by the next
merge — so don't rebuild a plan just because part of it already ran.

## 5. Report back — last

```bash
jt post /api/projects/$P/run-plan/built '{"summary": "<one line: N steps, how the reviews are placed, anything left out>"}'
```

This unlocks the tab. Then reply with a few lines — the steps in order, each
with who runs what and why that weight, and a note that every step keeps to
one orchestrator / 2 in flight — and stop. Don't start the plan;
that's the human's button.
