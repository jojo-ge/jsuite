---
name: jreview-triage
description: Triage a jReview run — read every reviewer's jExplain report, merge duplicate findings, publish a triage document, and POST the deduplicated findings back to jReview. Invoked as `/jreview-triage <key>` by the session jReview dispatches once all its reviewers have reported. Not for general use.
---

# jreview-triage

jReview ran several independent reviewer sessions over the same diff. Each
published its report as a jExplain document. Your job is to **dedupe**: turn
N overlapping reports into one clean list of findings the human can split
into tickets. You run in the reviewed repo (cwd), so you can check the code.

Argument: the review key.

API: `http://localhost:43008` (jReview; also https://jreview.local).

## 1. Read the run

```sh
curl -s http://localhost:43008/api/reviews/<key>
```

Gives `repoPath`, `base`, `reviewers[]` (`n`, `docKey`, `status`) and
`triage.docKey`. Read the report of every reviewer whose `status` is `done`
(skipped reviewers have no report):

```sh
curl -s http://localhost:43008/api/documents/<docKey>
```

Findings are the callout blocks (ids `f1`, `f2`, … titled
`[severity] claim`), usually with `**Where:**` and `**Category:**` lines.

## 2. Merge

- Two findings are **duplicates** when they describe the same underlying
  defect — same root cause at the same place — however differently worded.
  Different symptoms of one root cause are one finding. The same smell in two
  unrelated places is two findings.
- For a merged finding: the clearest title, the most concrete failure
  scenario, the union of the reviewers that raised it, and the **highest
  severity you can justify** from the code (look at it: `git diff
  <base>...HEAD`).
- Drop a finding only when reading the code shows it is wrong. Record every
  drop, with the reason, in the triage document. Don't invent new findings —
  you are the triager, not a fifth reviewer.
- Order: most severe first.

## 3. Publish the triage document

j-explain payload (block vocabulary in the `j-explain` skill), key =
`triage.docKey`:

- kicker `jReview · triage`; title `Triage — <repo> <base>...HEAD`; subtitle
  with the before/after counts ("23 reported → 11 distinct").
- `compare` block: findings by severity, with the reviewers that raised each.
- One `callout` per merged finding, ids `f1`… in the order you will POST them,
  titled `[severity] title`, with Where / Category / Raised by / failure
  scenario / fix.
- `compare` block **Merged**: each final finding → the reviewer block ids it
  absorbed (`r2:f3`, `r4:f1`).
- `prose` **Dropped**: what you dropped and why (or "none").

```sh
python3 ~/.claude/skills/j-explain/scripts/explain.py <payload.json> --replace --no-open
```

## 4. Hand the findings back — last

This POST flips the review to *triaged*, so send it only after the triage
document is published. Write the JSON to a file and post it:

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
      "detail": "Markdown: the failure scenario (input/state → wrong outcome), why it happens, the suggested fix.",
      "reviewers": [1, 3]
    }
  ]
}
```

```sh
curl -s -X POST http://localhost:43008/api/reviews/<key>/findings \
  -H 'content-type: application/json' -d @findings.json
```

`severity` is `critical` · `high` · `medium` · `low`; `file`/`line` optional;
each `detail` becomes a ticket description, so make it stand on its own.

Then reply with one line — "N reported → M distinct" plus the jReview URL
(`https://jreview.local/r/<key>`) — and stop. **Don't create tickets.** The
human decides that in jReview.
