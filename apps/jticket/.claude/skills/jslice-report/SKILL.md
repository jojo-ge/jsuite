---
name: jslice-report
description: Write a run plan's slice report into jTicket — a facts-only record of what one slice of a project built, where it lives, the decisions it made and what the next slice must know — then report back to the auto loop, which waits on it before starting the next implement step. Invoked as `/jslice-report [PROJ-n] step=[n] from=[sha] to=[sha] previous=[DOC-m]` by jTicket's run plan before an implement step whose integration tip moved since the last report. Not for general use.
disable-model-invocation: true
argument-hint: "[PROJ-n step=n from=sha to=sha previous=DOC-m]"
---

# jslice-report

jTicket's run plan runs a project in slices: an implement step, its merges
and reviews, then the next implement step. Before an implement step after
the first — only when the integration tip moved since the last report —
**you** write the slice report: what the slice that just landed built and
decided, for the next step's sessions to read before they touch code. They
read nothing else about the slice. You write it; you change no code and no
ticket. Facts only, at most 300 words; report back (§3) is the last step and
the loop waits on it.

Arguments: the project key; `step=` the implement step about to start (its
sessions are your readers); `from=` and `to=` the integration branch
commits the slice spans; `previous=` the last slice report, if any.

```bash
P=PROJ-2
```

Every call goes through `jt` (on PATH after `./jsuite setup`; else
`bin/jt` in the jSuite checkout; `jt help`), never hand-built `curl` —
reviews and their reports included: the review engine runs inside jTicket,
so they are jTicket routes too.

## The contract

The report is read by an agent with no memory of the slice and a ticket to
build on it. Every line must earn its place.

- **Facts only.** No introduction, no closing, no adjectives, no hedging, no
  restating the tickets, no narrative of what was tried.
- **Bullet points, one fact per bullet.** Name files, functions, endpoints
  and tickets by path or key.
- **Decisions as:** `<what> — because <why>. Rejected: <alternative>.` A
  decision with no rejected alternative is still a decision; a line with no
  "because" is not.
- **Outcomes as what exists now,** not what was done: "`server/utils/x.ts`
  holds the retry policy", not "added a retry policy".
- **At most 300 words.** A section with nothing in it is left out.
- **Tickets by key only** — the reader can open them.

## 1. Read the slice

```bash
# the project and the tickets the slice landed (keys are in your hand-off)
jt project $P
jt show TICK-7 | jq '{title, resolution, acceptanceCriteria, labels}'
# what landed — the squash commits in the range, and the diff
git -C <repo> log --oneline <from>..<to>
git -C <repo> diff --stat <from>..<to>
git -C <repo> diff <from>..<to> -- <the paths that matter>
```

Each ticket's `resolution` is where its implementer recorded what it did
and decided — read every one. For each review the hand-off names:

```bash
jt get /api/reviews/<key> | jq '{pass, reviewers: [.reviewers[] | {n, docKey, status}], tickets}'
jt get /api/documents/<docKey>     # each reviewer's report
```

A review's findings that became tickets are in the slice; what was raised
and dropped is not — leave it out unless it is a decision the next slice
needs ("X was considered and rejected because …").

If `previous=` names a report, read it so you don't repeat it — `/api/docs/DOC-m`
is only the tracker record; the content is at
`jt get /api/documents/$(jt get /api/docs/DOC-m | jq -r .documentKey)`.
This report covers only what changed since.

## 2. Write it

A jTicket doc in the block-document format (the `to-jspec` skill has the
block shapes). Title `<PROJ-n> slice report · before step <n>`, labels
`["slice", "slice:step-<n>"]`, status `ready`, project `<PROJ-n>`. These
sections, in this order, headings as given, empty ones left out:

```
## Built
- TICK-12: <what exists now, one line>

## Where
- path/to/module.ts — <what it holds now>

## Decisions
- <decision> — because <reason>. Rejected: <alternative>.

## Deviations and gaps
- TICK-13: <what differs from the ticket>. Carryover: TICK-20.

## For the next slice
- Use <seam/hook/convention>.
- Do not touch <thing> — <reason>.

Previous: DOC-m
```

The last line is a plain paragraph naming the previous report (omit it when
there is none).

```bash
jt post /api/docs @report.json
# → { key: "DOC-n", … }
```

Count the words before you post. Over 300: cut, don't compress — drop the
least useful bullets.

## 3. Report back — last

The loop waits on this; send it only once the doc exists:

```bash
jt post /api/projects/$P/auto/slice-report '{"doc": "DOC-n"}'
```

Reply with one line — the doc key and its word count — and stop. Don't ask
questions; nobody is watching this pane.
