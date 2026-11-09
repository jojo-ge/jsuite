---
name: jreview-consensus
description: Close a consensus jReview run — file the findings every reviewer agreed on as jTicket tickets.
argument-hint: "[KEY]"
disable-model-invocation: true
---

# jreview-consensus

jTicket's auto loop asked jReview for a **consensus review**: several reviewers
ran independently over the same diff (this loop's changes) and each published a
jExplain report. Your job is to find the findings **every** reviewer raised and
turn each one into a jTicket ticket — one the loop implements next, or, when
it's outside the project's goal, one the human decides on. Anything only
some reviewers raised is dropped — agreement is the filter. You run in the
reviewed checkout (cwd), so you can read the code. jReview runs this session
on Sonnet 5: match and file, don't re-review.

Argument: the review key.

APIs: jReview `http://localhost:43008` (curl); jTicket through the `jt` CLI
(`jt project KEY`, `jt projects --json`, `jt post PATH JSON|@file|-`, `jt new`,
`jt set` — `jt` alone prints the verbs). Never hand-build curl against :43000.

**Write no triage document and POST no findings to jReview.** The tickets are
the output; jReview only records their keys.

## 1. Read the run

```sh
curl -s http://localhost:43008/api/reviews/<key>
```

Gives `repoPath`, `base`, `branch`, `reviewers[]` (`n`, `docKey`, `status`),
`consensus` (`projectKey`, `loop`) and `pass` — `consensus` (or unset) for
the regular run, or `architecture`: ONE reviewer ran the `/jarch-review`
skill and the rules in §2a apply instead of §2. Every reviewer is `done` —
read each report:

```sh
curl -s http://localhost:43008/api/documents/<docKey>
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
Agreed by every reviewer in jReview [<title>](https://jreview.local/r/<key>) — reports: [reviewer 1](https://jexplain.local/e/<docKey1>) · [reviewer 2](https://jexplain.local/e/<docKey2>).
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
curl -s -X POST http://localhost:43008/api/reviews/<key>/consensus \
  -H 'content-type: application/json' \
  -d '{"ticketKeys": ["TICK-41", "TICK-42"], "considered": 9, "kept": 2}'
```

Zero agreed findings is a normal outcome — POST `{"ticketKeys": [],
"considered": <n>, "kept": 0}` so the loop moves on.

Then reply with one line — "N considered → M agreed → tickets … (K to <follow-ups key>)"
plus the jReview URL (`https://jreview.local/r/<key>`) — and stop. Don't implement
anything; the auto loop dispatches the tickets. jReview closes this pane (and
the reviewers') once you've gone idle.
