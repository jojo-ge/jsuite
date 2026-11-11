---
name: jreview-report
description: Publish a finished code review into jReview as this reviewer's report document.
argument-hint: "[review=KEY reviewer=N doc=DOCKEY]"
disable-model-invocation: true
---

# jreview-report

You are one of several jReview reviewer sessions. You have just run a code
review (the global `/code-review` skill, or `/jarch-review` on an architecture
pass).
This skill turns that review into a **jExplain document** at the exact key
jReview is watching. jReview polls the shared document pool: **the moment a
document exists at `doc=`, this reviewer counts as finished**, and when every
reviewer is finished a triage session merges all the reports (or, for a
consensus review, a consensus session files the agreed findings as tickets).

Arguments: `review=<key> reviewer=<n> doc=<docKey>`.

**You don't write the document.** The review is the expensive judgment and it's
done. Formatting it is mechanical, so you dump the review as plain text and a
Sonnet subagent builds and publishes the document.

## Rules

- Report only. Don't fix code, don't commit, don't create tickets. Tickets
  come later and are not yours: every review belongs to a jTicket project and
  its findings become tickets there — a consensus review's consensus session
  files the agreed findings; an agreement review's (a PR review project's)
  are filed by jTicket as record-only tickets when they are handed back; a
  plain review is triaged, then the human adds findings to the project from
  its Review tab.
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
SKILL: <which review skill ran — normally the global /code-review>
SOURCES: <spec/standards documents the review used, or "none found">
VERDICT: <one sentence — the overall verdict>
APPROVAL: approve | approve-with-nits | request-changes | needs-discussion — <one line why>   <only when the review prompt asked for an approvability verdict (a PR review)>

FINDING
severity: critical | high | medium | low
claim: <short claim>
where: <path:line>
category: <kebab-slug: correctness, standards, spec, security, performance, test-coverage, …>
scope: in | out   <only when the review prompt asked for scope — in = a defect in what the diff set out to do or a break; out = pre-existing debt, unrelated refactors, nice-to-haves>
scenario: <concrete input/state → wrong outcome>
fix: <the suggested fix>
quote: <optional — path:start-end, or "diff <path>", when showing the lines makes it clearer>

FINDING
…

TAKEAWAYS
- <what the triager and the human should carry away>
```

List findings most severe first.

`APPROVAL` (PR reviews only) is your call on merging the PR as it stands:
`approve` — nothing worth holding it for; `approve-with-nits` — only
low/medium findings the author can take or leave; `request-changes` — a
finding (or a failing check) that must be fixed first; `needs-discussion` —
the approach itself is in question. It's a recommendation the human reads;
never approve, comment on or touch the PR on GitHub yourself.

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
jt get /api/documents/<docKey> > /dev/null && echo landed
```

`landed` means you're done: reply with the subagent's one line and stop. If it's
anything else, the subagent failed. Read
`~/.claude/skills/jreview-report/reference/document.md` and publish the
document yourself, so triage isn't left waiting.
