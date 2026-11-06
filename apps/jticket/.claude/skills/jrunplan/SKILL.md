---
name: jrunplan
description: Build a jTicket project's run plan — read the project, its docs, every open ticket and the code, weigh each ticket, decide who runs what on which model and effort, and place merges, reviews and gates sparingly; save it through the run-plan API until it has no problems, then report back. Invoked as "/jrunplan <PROJ-n>" by the Run setup tab's Build button (one Fable 5.1 session at high effort). Not for general use.
disable-model-invocation: true
---

# jRunPlan — build the run plan

jTicket's Run setup tab handed you a project. You write its **run plan**: the
ordered steps auto mode walks — which tickets run together, who runs each
(its own agent, or an orchestrator working a group through subagents), on
which model at which effort, and where merges, reviews and gates go. The
human reads the plan on the board and presses Start; you don't run anything.
Nobody is watching your pane: decide rather than ask.

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
P=PROJ-2   # the project key you were invoked with
```

## 1. Read everything the plan rests on

```bash
curl -s "$JTICKET/api/projects/$P" | jq '{key, title, description, repo, integrationBranch, runPlan}'
curl -s "$JTICKET/api/docs?projectId=$P" | jq '[.[] | {key, title, labels, status}]'     # specs, slice reports, outcome reports
curl -s "$JTICKET/api/tickets?projectId=$P" | jq '[.[] | select(.status != "done" and .status != "merged") | {key, title, type, labels, status, blockedBy, acceptanceCriteria, description}]'
```

`blockedBy` holds ticket **ids**; map them to keys with the full list
(`curl -s "$JTICKET/api/tickets" | jq 'map({(.id): .key}) | add'`). A ticket
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
spec-checks each. A heavy ticket alone gains nothing from one. Inside one
step, a group of light tickets may run cheap beside a group of medium ones —
each group carries its own model and effort (`groupRunners`).

## 3. Shape the steps

- **Implement steps** hold tickets that can run side by side: disjoint areas,
  no open blocker among them. Up to 4 orchestrator groups per step, each with
  1–4 in flight (`budget`); group by area so one orchestrator's subagents
  don't collide.
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
  "tickets": ["TICK-7", "TICK-8", "TICK-9", "TICK-12"],
  "dispatch": { "mode": "orchestrated", "model": "opus", "effort": "high", "budget": 2, "orchestrators": 1 },
  "groups": [["TICK-7", "TICK-8"], ["TICK-9"]],            // orchestrator groups; a ticket in none runs as its own agent
  "groupRunners": [{ "model": "sonnet", "effort": "low" }, null],   // per group; null = the step's dispatch
  "runners": { "TICK-12": { "model": "opus", "effort": "high" } }   // a solo ticket's own model/effort
}
{ "id": "s2", "kind": "merge" }
{ "id": "s3", "kind": "review", "reviewers": 2, "base": "",       // "" = since the previous review or plan start; "start"; or an earlier step id
  "review": { "model": "opus", "effort": "medium", "arch": null } } // arch: null, or { "model", "effort" } for the architectural pass first
{ "id": "s4", "kind": "gate", "note": "check the migration on staging" }
```

Models: `opus`, `sonnet`, `haiku`, `fable`. Efforts: `low`, `medium`,
`high`, `xhigh`, `max`. `mode` follows the groups (any group → orchestrated).
A step without `dispatch` runs on the run's default (Opus 5.5 high) — set it
on every implement step instead, so the board says what you decided.

```bash
curl -s -X PUT "$JTICKET/api/projects/$P/run-plan" -H 'content-type: application/json' -d @plan.json | jq '.problems'
```

The answer's `problems` are what would stop the plan running (a blocker in
the wrong step, a missing merge, a finished ticket). Fix and PUT again until
it is `[]`. The draft saves each time, so the human sees the board fill.

## 5. Report back — last

```bash
curl -s -X POST "$JTICKET/api/projects/$P/run-plan/built" -H 'content-type: application/json' \
  -d '{"summary": "<one line: N steps, how the reviews are placed, anything left out>"}'
```

This unlocks the tab. Then reply with a few lines — the steps in order, each
with who runs what and why that weight — and stop. Don't start the plan;
that's the human's button.
