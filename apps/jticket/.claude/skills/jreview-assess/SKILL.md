---
name: jreview-assess
description: Assess one GitHub pull request for a jTicket PR review project — read the PR and the code it touches, decide how many reviewers it needs (2–4) and what they all focus on, publish the brief every reviewer reads, add check tickets where running something proves more than reading, save the review plan and report back. Invoked as "/jreview-assess [PROJ-n]" by the Review setup tab's Assess button (one Fable 5.2 session at high effort). Not for general use.
disable-model-invocation: true
argument-hint: "[PROJ-n]"
---

# jreview-assess — size the review of one PR

A PR review project handed you a pull request. You decide **how it gets
reviewed**: how many reviewers (2–4, every one on the same brief), what that
brief points them at, and whether anything should be *run* against the PR
before they read it. You write that down as the project's **review plan** and
report back; the plan's runner does the rest. Nobody is watching this pane:
decide, don't ask.

**Never** commit, push, comment on, approve or label the PR, and never edit
the repo's checkout. You read.

```bash
P=PROJ-7   # the key you were invoked with
jt project $P | jq '{key, title, repo, integrationBranch, prReview: .prReview | {pr, assessment, plan}}'
```

Every jTicket call goes through `jt` (`jt help`), never hand-built curl.

## 1. Read the PR

```bash
N=<prReview.pr.number>; REPO=<repo>; BASE=origin/<prReview.pr.baseRefName>; HEAD=<integrationBranch>
gh pr view $N --json title,body,author,labels,files,additions,deletions,commits,reviews,comments,statusCheckRollup
git -C "$REPO" diff --stat "$BASE...$HEAD"
git -C "$REPO" diff "$BASE...$HEAD"
git -C "$REPO" log --oneline "$BASE..$HEAD"
```

You are cd'd into the repo, but its checkout is the human's — read other
revisions with `git show $HEAD:<path>`, never `git checkout`. Read the code
around the change, not just the hunks: callers of what changed, the tests
that cover it (or don't), the contracts it touches. Read the PR's linked
issue or spec when the body names one, and the CI result
(`statusCheckRollup`): a red CI is already a fact.

Done when you can say, in two sentences each: what the PR does, where it can
break things, and what is already proven (CI, tests in the diff).

## 2. Decide the reviewers — 2 to 4

Consensus is the filter downstream: **only findings every reviewer raises
survive**. More reviewers = stricter agreement and more cost, not more
findings.

| Reviewers | When |
| --- | --- |
| 2 | small or mechanical: a dependency bump, a rename, a config change, a contained bug fix with a test |
| 3 | a normal feature or fix inside one or two modules |
| 4 | large, cross-cutting, security- or money-sensitive, concurrency, migrations, public API/contract changes |

Pick the focus areas — 2 to 6 short labels the brief expands on
(`retry/backoff correctness`, `migration reversibility`, `auth on the new
routes`, `test coverage of the error path`). Every reviewer reviews the
**whole** diff; the focus says where to dig hardest.

Risk: `low` / `medium` / `high` — what goes wrong in production if a defect
here slips through.

## 3. Publish the brief

One jTicket doc on the project, labelled `review:brief` — the same text every
reviewer reads before the diff. Write it to the reviewers, not about them:

- **What this PR does** — in the domain's words, 3–5 lines.
- **Focus areas** — one section each: what to check and why it's risky here,
  naming files and functions.
- **What's already proven** — CI status, tests added, checks you're adding
  (§4) by ticket key: "don't spend time re-proving these".
- **Out of scope** — pre-existing debt the PR merely sits next to.
- **The codebase's standards** — where they live (CLAUDE.md, a review skill in
  `.claude/skills`, CONTRIBUTING).

```bash
jt post /api/docs @brief.json     # {"title": "PR #<n> — review brief", "project": "<P>", "labels": ["review:brief"], "status": "ready", "kicker": "REVIEW BRIEF", "blocks": [...]}
```

Block vocabulary: the `to-jdoc` skill. Keep the returned `key` (DOC-n). On a
**reassess**, publish a fresh brief (the old one stays as history).

## 4. Checks — only where running beats reading

A check is one ticket that a `/jpr-check` session runs against the PR head in
a throwaway worktree: it runs something, reads the result and records a
verdict (`pass` / `fail` / `concern` / `inconclusive`). Reviewers read the
verdicts first. Add one only when running it proves something a reader
can't:

- the test suite for the touched packages, when CI didn't run it or is red
  for unclear reasons
- typecheck / lint / build, when the PR touches config or build tooling
- a targeted stress or edge-case script (concurrency, large input, the
  failure path the PR adds handling for)
- a migration dry-run (up, then down) on a scratch database
- a reproduction of the bug the PR claims to fix, at the base AND the head

Most PRs need **none to three**. Green CI over the touched code means don't
re-run the suite. Never a check that needs secrets, production data or the
network beyond the repo's own dev setup.

Each check ticket — `type: verification`, labels `["afk", "pr:check"]`:

```bash
jt post /api/import @checks.json
# {"tickets": [{"title": "Run the payments package tests against the PR head", "type": "verification",
#   "project": "<P>", "labels": ["afk", "pr:check"],
#   "description": "What to run, exactly (commands), what a pass looks like, what to look for in a failure.",
#   "acceptanceCriteria": ["The verdict and the trimmed output are on the resolution"]}]}
```

On a reassess, reuse open check tickets that still apply; close ones that
don't (`jt set KEY status=done resolution="Dropped on reassess: <why>"`) and
leave them out of the plan.

## 5. Save the plan

The plan ends with **one review step**; checks (if any) come first. A `gate`
only when the human should read a check result before the reviewers spend
their time (e.g. a check that might show the PR doesn't even build).

```bash
jt put /api/projects/$P/review-plan @plan.json
# {"steps": [
#   {"id": "r1", "kind": "checks", "tickets": ["TICK-41", "TICK-42"],
#    "runners": {"TICK-42": {"model": "sonnet", "effort": "low"}}},
#   {"id": "r2", "kind": "review", "reviewers": 3, "model": "opus", "effort": "high", "verify": true}
# ]}
```

- Checks run 4 at once, each its own session — Opus 5.5 `medium` by default;
  `sonnet`/`low` for "run this command and read the output", `opus`/`high`
  for a check that has to write a stress test.
- Reviewers: `opus` at `high` by default; `xhigh` only for the high-risk PRs.
  Keep `verify: true` — every agreed finding faces an adversarial verifier
  before the human sees it.

The response carries `problems`. Fix and PUT again until it is `[]`.

## 6. Report back — last

```bash
jt post /api/projects/$P/pr-review/assessed "$(jq -n --arg brief DOC-n \
  '{reviewers: 3, focus: ["…", "…"], briefDoc: $brief, rationale: "…", risk: "medium"}')"
```

`rationale`: one short paragraph — why this many reviewers, these focus
areas, these checks (or why none). The response says whether the plan
started (`started`) — the human may have asked it to wait.

Then reply with one line — "<P>: <n> reviewers on <DOC-n>, checks <keys or
none>, risk <risk> — <started | waiting for Start>" — and stop.
