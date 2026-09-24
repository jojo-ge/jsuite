---
name: jreview-report
description: Publish a finished code review into jReview as a jExplain document at a pre-assigned key — the document landing is how jReview knows this reviewer is done. Invoked as `/jreview-report review=<key> reviewer=<n> doc=<docKey>` by a jReview reviewer session after its code-review skill has run. Not for general use.
---

# jreview-report

You are one of several jReview reviewer sessions. You have just run a code
review (the target repo's own code-review skill, or the global `/code-review`).
This skill turns that review into a **jExplain document** at the exact key
jReview is watching. jReview polls the shared document pool: **the moment a
document exists at `doc=`, this reviewer counts as finished**, and when every
reviewer is finished a triage session merges all the reports.

Arguments: `review=<key> reviewer=<n> doc=<docKey>`.

**You don't write the document.** The review is the expensive judgment and it's
done. Formatting it is mechanical, so you dump the review as plain text and a
Sonnet subagent builds and publishes the document.

## Rules

- Report only. Don't fix code, don't commit, don't create tickets — the human
  turns findings into tickets from jReview after triage.
- If the review found nothing, still dump it (no FINDING sections) — the
  document must still land, or triage waits on you forever.
- Never publish a draft or a placeholder yourself — a partial document ends
  your slot early and the triager reads whatever is there.

## 1. Dump the review

Write `/tmp/jreview/<review>/reviewer-<n>.txt` in this plain-text shape. Keep it
terse: the subagent works in this checkout and pulls out code, diffs and the
commit list itself, so don't paste code. Point at it with `quote:`.

```
BASE: <the fixed point>
SKILL: <which review skill ran — the repo's own (name it) or the global /code-review>
SOURCES: <spec/standards documents the review used, or "none found">
VERDICT: <one sentence — the overall verdict>

FINDING
severity: critical | high | medium | low
claim: <short claim>
where: <path:line>
category: <kebab-slug: correctness, standards, spec, security, performance, test-coverage, …>
scenario: <concrete input/state → wrong outcome>
fix: <the suggested fix>
quote: <optional — path:start-end, or "diff <path>", when showing the lines makes it clearer>

FINDING
…

TAKEAWAYS
- <what the triager and the human should carry away>
```

List findings most severe first.

## 2. Hand it to Sonnet

Call the Agent tool with `model: "sonnet"` and `subagent_type:
"general-purpose"`, and this prompt with the placeholders filled in:

> Build and publish a jReview reviewer report. Read
> `~/.claude/skills/jreview-report/reference/document.md` and follow it
> exactly. The review dump is `/tmp/jreview/<review>/reviewer-<n>.txt`; the
> reviewed checkout is `<absolute cwd>`. Arguments: review=<review>
> reviewer=<n> doc=<docKey>. Reply with one line: the published key, the
> finding count, and the URL.

## 3. Check it landed

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:43008/api/documents/<docKey>
```

`200` means you're done: reply with the subagent's one line and stop. If it's
anything else, the subagent failed. Read
`~/.claude/skills/jreview-report/reference/document.md` and publish the
document yourself, so triage isn't left waiting.
