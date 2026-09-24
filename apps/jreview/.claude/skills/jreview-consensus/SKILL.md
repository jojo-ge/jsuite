---
name: jreview-consensus
description: Close a consensus jReview run for jTicket's auto loop — read every reviewer's jExplain report, keep only the findings EVERY reviewer raised, file each straight into the loop's jTicket project as an AFK bug ticket, and POST the ticket keys back to jReview. Invoked as `/jreview-consensus <key>` by the session jReview dispatches once all of a consensus review's reviewers have reported. Not for general use.
---

# jreview-consensus

jTicket's auto loop asked jReview for a **consensus review**: several reviewers
ran independently over the same diff (this loop's changes) and each published a
jExplain report. Your job is to find the findings **every** reviewer raised and
turn each one into a jTicket ticket the loop will implement next. Anything only
some reviewers raised is dropped — agreement is the filter. You run in the
reviewed checkout (cwd), so you can read the code.

Argument: the review key.

APIs: jReview `http://localhost:43008`, jTicket `http://localhost:43000`.

**Write no triage document and POST no findings to jReview.** The tickets are
the output; jReview only records their keys.

## 1. Read the run

```sh
curl -s http://localhost:43008/api/reviews/<key>
```

Gives `repoPath`, `base`, `branch`, `reviewers[]` (`n`, `docKey`, `status`)
and `consensus` (`projectKey`, `loop`). Every reviewer is `done` — read each
report:

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
  Keep only agreed findings. Don't add findings of your own, and don't rescue
  a finding one reviewer missed because you think it's right.
- Drop an agreed finding only when reading the code (`git diff
  <base>...HEAD`) shows it is plainly wrong. Say so in your final reply.
- For each agreed finding: the clearest title, the most concrete failure
  scenario, and the **highest severity the code justifies**.
- Count the distinct findings you weighed (agreed or not) — that's
  `considered`.

## 3. File the tickets into jTicket

One AFK bug ticket per agreed finding, into `consensus.projectKey` **by key**,
with no `blockedBy` — they must land on the loop's frontier. Write the JSON to
a file and post it:

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
curl -s -X POST http://localhost:43000/api/import \
  -H 'content-type: application/json' -d @tickets.json
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

Then reply with one line — "N considered → M agreed → tickets …" plus the
jReview URL (`https://jreview.local/r/<key>`) — and stop. Don't implement
anything; the auto loop dispatches the tickets.
