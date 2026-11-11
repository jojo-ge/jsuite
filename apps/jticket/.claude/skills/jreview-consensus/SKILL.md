---
name: jreview-consensus
description: Close a consensus jReview run — file the findings every reviewer agreed on as jTicket tickets; or, for an agreement review (a PR review plan), verify them adversarially, judge approvability and hand them back as findings, which jTicket files on the PR review project as record-only tickets.
argument-hint: "[KEY]"
disable-model-invocation: true
---

# jreview-consensus

Several reviewers ran independently over the same diff and each published a
jExplain report. Your job is to find the findings **every** reviewer raised.
Anything only some reviewers raised is dropped — agreement is the filter. You
run in the reviewed checkout (cwd), so you can read the code. Don't add
findings of your own.

Argument: the review key.

API: jTicket — the review engine included — through the `jt` CLI
(`jt project KEY`, `jt projects --json`, `jt post PATH JSON|@file|-`, `jt new`,
`jt set` — `jt` alone prints the verbs). Never hand-build curl against :43000.

The run is one of two kinds, and §1 tells you which. Every review belongs to
a jTicket project and its findings always end up as tickets there — the two
kinds differ in who files them and what the tickets are for:

| | **Consensus review** (`consensus` is set) | **Agreement review** (`agreement` is set) |
| --- | --- | --- |
| Who asked | jTicket's auto loop or a run plan — the diff is this loop's own changes | a PR review project's review plan — the diff is someone else's pull request |
| You run on | Sonnet 5 — match and file, don't re-review | Opus 5.5 — you also verify each finding and judge approvability |
| Follow | §2 (or §2a) → §3 → §4 | §A, in place of §2a–§4 |
| Tickets | **you** file one per agreed finding (§3) — work the loop implements next, or the human decides on | **jTicket** files one per finding you hand back (§A5) — record-only, never dispatched, nothing is fixed. You file none |
| You write | no document | the consensus document (§A4) |
| You POST | the ticket keys to `/consensus` (§4) — never `/findings` | the findings + assessment to `/findings` (§A5) — never `/consensus` |

## 1. Read the run

```sh
jt get /api/reviews/<key>
```

Gives `repoPath`, `base`, `branch`, `reviewers[]` (`n`, `docKey`, `status`),
`consensus` (`projectKey`, `loop`) — or, instead, `agreement` (`loop`) with
`project`, `pr`, `verify`, `context` (`brief`, `checks`) and
`triage.docKey`: an agreement review, §A — and `pass` — `consensus` (or unset) for
the regular run, or `architecture`: ONE reviewer ran the `/jarch-review`
skill and the rules in §2a apply instead of §2. Every reviewer is `done` —
read each report:

```sh
jt get /api/documents/<docKey>
```

Findings are the callout blocks (ids `f1`, `f2`, … titled `[severity] claim`),
usually with `**Where:**` and `**Category:**` lines.

## 2. Match

- Two findings **match** when they describe the same underlying defect — same
  root cause at the same place — however differently worded. Different
  symptoms of one root cause match. The same smell in two unrelated places
  does not.
- A finding is **agreed** when every reviewer's report has a match for it.
  Keep only agreed findings. (With one reviewer agreement is trivial — every
  finding is agreed; the code check below is then your only filter.) Don't add findings of your own, and don't rescue
  a finding one reviewer missed because you think it's right.
- Drop an agreed finding only when reading the code (`git diff
  <base>...HEAD`) shows it is plainly wrong. Say so in your final reply.
- For each agreed finding: the clearest title, the most concrete failure
  scenario, and the **highest severity the code justifies**.
- **Scope.** Each report marks its findings `**Scope:** in` or `out`. An
  agreed finding is **in scope** when any reviewer marked it in, or its
  severity is `critical` (a break is always fixed), or it concerns code this
  diff added or changed. It is **out of scope** when every reviewer marked it
  out and it is pre-existing debt, an unrelated refactor or a nice-to-have.
  Reports without scope lines (older reviewers): in scope when the finding
  sits in the diff, out otherwise.
- Count the distinct findings you weighed (agreed or not) — that's
  `considered`.

## 2a. An architecture pass — no vote

With `pass: architecture` there is one report and agreement means nothing.
Instead:

- Every finding with `**Category:** architecture` is **mandatory**: file it
  as an AFK ticket exactly as §3 says (type `task`, label
  `review:architecture` in place of `review:finding`). The loop implements
  and merges these before the regular reviewers run.
- Every finding with `**Category:** technical` is **advisory**: file it as
  a ticket the loop leaves alone — same import as §3, `"project":
  "<consensus.projectKey>"` (the loop's project, never the follow-ups one),
  labels `["hitl", "jreview", "review:advisory", "severity:…",
  "category:technical", "auto-loop:<n>"]`, no `blockedBy`. The human decides
  later.
- Drop a finding only when the code shows it plainly wrong; say so.
- `considered` = every finding in the report; `kept` = the mandatory ones.
- In §4, `ticketKeys` are the **mandatory** keys only — the advisory ones
  exist in jTicket but are not the loop's to fix.

## 3. File the tickets into jTicket

One AFK bug ticket per agreed **in-scope** finding, into `consensus.projectKey`
**by key**, with no `blockedBy` — they must land on the loop's frontier. First
verify the project exists — `jt project <projectKey>` — an unknown `project`
ref creates project-less tickets the loop never sees. Then write the JSON to a
file and post it:

```json
{
  "tickets": [
    {
      "title": "Retry loop never backs off after a 429",
      "type": "bug",
      "project": "PROJ-7",
      "labels": ["afk", "jreview", "review:finding", "severity:high", "category:correctness", "auto-loop:3"],
      "description": "…",
      "acceptanceCriteria": ["The failure scenario described above no longer occurs, and a test covers it"]
    }
  ]
}
```

```sh
jt post /api/import @tickets.json
```

The response's `tickets[].key` are the new keys. `auto-loop:<n>` uses
`consensus.loop` (leave the label off when there is no loop). The
`description` is markdown and must stand on its own — the implementer reads
nothing else:

```
**Severity:** high · **Category:** correctness · **Where:** `src/client/retry.ts:42`

<one sentence stating the defect>

**Failure scenario:** <input/state → wrong outcome>

**Suggested fix:** <what to change>

**How each reviewer put it:**
- Reviewer 1: <their claim, one line>
- Reviewer 2: <their claim, one line>

---
Agreed by every reviewer in jReview [<title>](https://jticket.local/reviews/<key>) — reports: [reviewer 1](https://jticket.local/e/<docKey1>) · [reviewer 2](https://jticket.local/e/<docKey2>).
```

No agreed findings → skip this step entirely.

### 3a. Out-of-scope findings → the follow-ups project

The loop fixes only what the slice set out to do; out-of-scope findings
would pull it off task. File each agreed out-of-scope finding into a
separate project titled **`<projectKey> follow ups`** (e.g. `PROJ-7 follow
ups`) — find it by title, create it when there isn't one:

```sh
jt projects --json | jq -r '.[] | select(.title == "PROJ-7 follow ups") | .key'
# none → create it on the same repo (no integration branch; the human cuts one when they pick it up)
jt post /api/projects '{"title": "PROJ-7 follow ups", "repo": "<repoPath>", "description": "Out-of-scope findings from PROJ-7 reviews — agreed by every reviewer, left for later so the run stayed on task."}'
```

The title match can return several keys when duplicate follow-ups projects
exist: pick the one whose `repo` is this review's `repoPath`, and among those
the newest (highest key). Never create another when one matches.

Then the same `jt post /api/import` call as §3 with `"project": "<follow-ups key>"`,
labels `["afk", "jreview", "review:follow-up", "severity:…", "category:…"]`
(no `auto-loop:<n>`), and a first description line saying which review and
project it came from. These keys are **not** in §4's `ticketKeys`.

## 4. Hand the keys back — last

This POST flips the review to *ticketed*, which is what the auto loop waits
on, so send it only after the tickets exist:

```sh
jt post /api/reviews/<key>/consensus '{"ticketKeys": ["TICK-41", "TICK-42"], "considered": 9, "kept": 2}'
```

Zero agreed findings is a normal outcome — POST `{"ticketKeys": [],
"considered": <n>, "kept": 0}` so the loop moves on.

Then reply with one line — "N considered → M agreed → tickets … (K to <follow-ups key>)"
plus the review's URL (`https://jticket.local/reviews/<key>`) — and stop. Don't implement
anything; the auto loop dispatches the tickets. jReview closes this pane (and
the reviewers') once you've gone idle.

## A. An agreement review — verify, assess, hand back

Everything here replaces §2a–§4: **you file no tickets** (no `/api/import`, no
`jt new` — jTicket files each finding you hand back in §A5 as a record-only
ticket on `project`), **no follow-ups project, no /consensus POST, and never
anything on GitHub** (no `gh pr review`, no `gh pr comment`, no approval —
that is the human's, always).

### A1. Match

§2's matching rules exactly: keep a finding only when **every** reviewer's
report has a match; the highest severity the code justifies; drop one only
when the code shows it plainly wrong. Scope: an agreed finding is `in` when
any reviewer marked it in or it sits in code the PR adds or changes,
otherwise `out` (pre-existing) — keep both, marked. Count `considered` (the
distinct findings you weighed).

**A rerun.** The project may already hold finding tickets from an earlier
run of this PR's review. Read the open ones:

```sh
jt ls projectId=<project> --json \
  | jq '[.[] | select((.labels | index("review:finding")) and (.status == "todo" or .status == "in_progress")) | {key, title, where: .finding.file, line: .finding.line}]'
```

When an agreed finding is the same defect as one of them — same root cause
at the same place, however the title is worded now — send that ticket's key
as the finding's `ticketKey` in §A5, and jTicket updates that ticket instead
of filing a duplicate. No match → leave `ticketKey` out. (jTicket also
matches by title and file on its own; your `ticketKey` is for the ones only
a reader can tell are the same.) Never close, edit or comment on those
tickets yourself.

**Checks.** Read each ticket in `context.checks` (`jt show <key>` — the
resolution opens with `**Verdict:** pass | fail | concern | inconclusive`). A
`fail` (or a `concern` with concrete evidence) is a finding in its own right,
needing no reviewer's agreement — category `check`, `reviewers: []`, its
evidence from the resolution. Don't duplicate one a reviewer already raised:
merge into it.

### A2. Verify — only when `verify` is true

Every agreed finding faces a skeptic before it reaches the human. Launch one
subagent per finding — Agent tool, `model: "opus"`, `subagent_type:
"general-purpose"`, several at once (at most 4 in flight) — with this prompt,
filled in:

> You are an adversarial verifier. A code review of `git diff <base>...HEAD`
> in `<absolute cwd>` claims: **[<severity>] <title>** at `<file:line>` —
> <summary> Failure scenario: <scenario>. Your job is to REFUTE it: read the
> code and its callers, look for the guard, test or invariant that makes the
> scenario impossible; if a quick throwaway check (a test you run and then
> delete, a REPL call) settles it, run it — never commit, never leave files
> behind, never touch GitHub. Reply with exactly one line:
> `CONFIRMED: <evidence>` (you tried and it holds), `PLAUSIBLE: <why it
> could not be settled>`, or `REFUTED: <the evidence that kills it>`.

Drop every `REFUTED` finding (list them, with the evidence, in the document
and your final reply). Keep the rest with `verdict: confirmed | plausible`
and the evidence as `verification`. A `plausible` critical/high keeps its
severity — doubt is not a downgrade.

Without `verify`, skip this and send no `verdict`.

### A3. Assess approvability

Read each report's `approval` callout (`Approval: <verdict>` — the reviewer's
call) and decide the PR's:

| verdict | when |
| --- | --- |
| `request-changes` | any surviving in-scope `critical`/`high` finding, or a failing check |
| `needs-discussion` | the reviewers split on the approach itself, or a finding questions the design rather than a line |
| `approve-with-nits` | only `medium`/`low` in-scope findings (or only out-of-scope ones) |
| `approve` | nothing in scope survived |

`summary`: a short paragraph addressed to the PR's author — what the PR does
well, what holds it back; the human edits it before posting. `blockers`: one
line per thing that must change before it merges ([] for the approve
verdicts). `reviewerVerdicts`: each reviewer's own call. **This is a
recommendation the human reads — never act on it.**

### A4. Publish the summary document

j-explain payload (block vocabulary in the `j-explain` skill), key =
`triage.docKey`, published with `python3
~/.claude/skills/j-explain/scripts/explain.py <payload.json> --replace
--no-open`:

- kicker `jReview · consensus`; title `PR #<n> — <verdict>`; subtitle
  "<considered> raised → <kept> agreed<, R refuted>".
- `callout` id `assessment` (tone `success` for the approve verdicts,
  `warning` otherwise): the summary and blockers.
- One `callout` per kept finding, ids `f1`… in POST order, titled
  `[severity] title`, with Where / Category / Scope / Raised by /
  Verification / scenario / fix.
- `prose` **Dropped**: refuted and code-disproved findings, with the
  evidence (or "none").

### A5. Hand back — last

Write the JSON to a file and POST it — this flips the review to *triaged*,
which is what the review plan waits on:

```json
{
  "findings": [
    {
      "title": "Retry loop never backs off after a 429",
      "severity": "high",
      "category": "correctness",
      "file": "src/client/retry.ts",
      "line": 42,
      "summary": "One sentence stating the defect.",
      "detail": "Markdown: the failure scenario, why it happens, the suggested fix — written to the PR author, it may be posted as a review comment.",
      "reviewers": [1, 2, 3],
      "scope": "in",
      "verdict": "confirmed",
      "verification": "Ran the client against a stub returning 429 three times: four requests in 40ms.",
      "ticketKey": "TICK-41"
    }
  ],
  "assessment": { "verdict": "request-changes", "summary": "…", "blockers": ["…"], "reviewerVerdicts": [{ "n": 1, "verdict": "request-changes" }] },
  "considered": 9,
  "kept": 3
}
```

```sh
jt post /api/reviews/<key>/findings @findings.json
```

Most severe first; `file`/`line` must be the PR's new-side path and line (they
become inline comments when the human posts). `ticketKey` only for a finding
you matched to an open finding ticket in §A1 — omit it otherwise. Zero
survivors is normal — POST `"findings": []` with the assessment.

The POST is also what files the tickets: jTicket turns each finding into a
record-only ticket on `project` carrying its scope, verdict, file and line
(or updates the open ticket it matched), and answers with
`tickets: { created, matched, withdrawn }`. Those tickets are records of what
was found in someone else's PR — nothing dispatches them and nobody fixes
them here; the human picks which to post to the PR. A re-POST replaces the
set, and closes the tickets it filed for findings you dropped.

Then reply with one line —
"N raised → M agreed → K verified (R refuted) · <verdict> · tickets …" plus the
review's URL — and stop. The POST opens the project's Review tab; jReview
closes this pane.
