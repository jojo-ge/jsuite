---
name: jplan-review
description: Review a jTicket plan project's spec and ticket plan before its builds run — does the spec hold against the code, are decisions missing, is each proposed build a reviewable slice, are the tickets and reviews right — as one reviewer of a plan review; publishes through `/jreview-report`. Dispatched by a plan review project's Review tab. Not for general use.
argument-hint: "[PROJ-n]"
disable-model-invocation: true
---

# jplan-review

You are one reviewer of a **plan review**: several reviewers read the same
plan independently, and a consensus session keeps only the findings every
one of you raised. The plan is a jTicket plan project whose decisions are
made; its **ticket plan** cuts the work into builds, each one project whose
work lands as one roll-up PR. Nothing is built yet. Your findings are what
the human settles on the plan before any build starts, so the cheapest
mistakes to catch are here.

The goal that judges everything: **reasonably reviewable slices**. A build is
right when a person can review its roll-up PR in one sitting and it stands on
its own.

You review; you change nothing. The plan, its tickets and docs are the
human's: read them only. The checkout you are in is the codebase's main
checkout: read files and run read-only git commands, nothing that writes.

```bash
P=PROJ-3   # the plan project your hand-off names
```

Every jTicket call goes through `jt` (`jt help`), never hand-built `curl`.

## 1. Read the plan

```bash
jt project $P | jq -r .description                                    # the map: destination, decisions so far, out of scope
jt ls projectId=$P --json | jq '[.[] | select(.plannedFor == null) | {key, title, type, status, labels, resolution}]'   # the decisions
jt get "/api/docs?projectId=$P" | jq '[.[] | {key, title, documentKey, labels}]'
jt get /api/documents/<documentKey>                                   # each doc's content — the spec is the one labelled spec
jt get /api/projects/$P/ticket-plan                                   # builds, their notes, drafts, blockers, reviews, problems
```

The ticket plan's `builds[]` are the proposed builds in graph order: `note`
(the slice, its expected size, what it stacks on), `after` (the nodes it
comes after), `reviews` (the review nodes after it) and `drafts[]` (`key`,
`title`, `type`, `hitl`, `criteria`, `blockedBy` with where each blocker
sits). `reviews[]` are the review and plan review nodes; `unplaced[]` drafts
whose build is gone; `problems[]` the warnings jTicket already sees. Read a
draft in full with `jt show <key>`. A build already approved has its tickets
in its own project: `jt ls projectId=<build key> --json`.

Done when you can say, for every build, what it delivers and which tickets
deliver it, and, for every decision, where the spec carries it out.

## 2. Read the code

For each build, find the code its tickets change: what exists, what the
tickets assume exists, and how large each change really is. A plan's
mistakes show only against the code: a module the spec calls new that
exists already, a function a ticket extends that has a different shape, a
change sized at 200 lines that touches 40 call sites.

## 3. What you look for

Work through every item against every build. Each is a **finding** when it
holds.

**The spec against the code**
- The spec states something the code contradicts: an API, a data shape, a
  constraint, where something lives.
- The spec needs code that isn't there and no ticket builds it.

**Decisions**
- A choice the builds depend on that no resolved ticket made and the spec
  leaves open: name the build that stalls on it.
- The spec or a draft contradicts a decision's resolution: name both.
- A plan ticket still open whose answer would change a build's shape.

**Builds as slices**
- Too large to review in one sitting: over ~800 changed lines or ~30 files
  by your own sizing from the code, whatever its note says. Name the seam to
  split it along.
- Wrongly cut: two ideas in one build, or one idea split so neither build
  stands on its own.
- Needs code from a build it does not come after: a draft blocked by, or
  silently assuming, work of a build that is not upstream of it in the graph.
- A note whose size estimate the code does not bear out.

**Tickets**
- Missing: work the spec needs that no draft covers (migrations, wiring,
  tests, docs the change implies).
- Duplicated across drafts or builds.
- Mis-ordered: a blocker missing, or one pointing the wrong way.
- Vague: acceptance criteria an implementer can't check, or a description
  that leaves the approach to guesswork where the spec decided it.
- Wrong agency: HITL work marked AFK, or the reverse.

**Reviews**
- Missing where needed: a non-trivial build with no review after it, or a
  risky plan (a migration, a security boundary, a public contract) with no
  plan review before its builds.
- Present where not needed: a review after a trivial build (a doc, config,
  a handful of lines).

Done when every item has been checked against every build and every draft.

## 4. Write each finding

Each finding names the **build, ticket or decision** it concerns, in its
claim: `Build "Cart UI" needs the session store from "Auth API", which it
doesn't come after`, never `ordering is off`. The fix says what to change
in the plan: split, reorder, add a ticket, decide X.

| severity | when |
| --- | --- |
| critical | the plan as cut builds the wrong thing, or a build cannot be done in its place (code it needs comes later or nowhere) |
| high | a build too large to review, a missing decision that changes a build's shape, the spec contradicting the code |
| medium | a missing or duplicated ticket, a wrong blocker, criteria an implementer can't check |
| low | a size estimate off, wording, a review that could go |

`category` is one of `spec`, `decision`, `slicing`, `ordering`, `tickets`,
`criteria`, `reviews`. `where` is the build (`build "<title>"`), the ticket
(`TICK-n`), the decision (`decision TICK-n`) or the spec section
(`DOC-n §<heading>`); a finding about code says `path:line` there instead.

Your verdict is about running the builds as planned: `approve` (run them),
`approve-with-nits` (only medium/low findings), `request-changes` (a
critical or high finding the plan must settle first), `needs-discussion`
(the cut itself is in question).

## 5. Publish

Your hand-off names the report skill's file and your `review=`,
`reviewer=` and `doc=`: read it and follow it. In the dump, `BASE:` is
`plan <PROJ-n>`, `SKILL:` is `/jplan-review`, `SOURCES:` the docs and
tickets you read; leave `scope:` out. The document landing at `doc=` is what
tells jTicket you are done.
