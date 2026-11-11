---
name: jpr-check
description: Run one check from a jTicket PR review project against the pull request's head — in a throwaway worktree, read-only — and record the verdict (pass / fail / concern / inconclusive) with the evidence on the ticket. Invoked as "/jpr-check [TICK-n]" by a PR review project's review plan. Not for general use.
disable-model-invocation: true
argument-hint: "[TICK-n]"
---

# jPR check — run it, read it, record it

A PR review project's review plan dispatched you with one **check ticket**:
something to *run* against a pull request's head before the reviewers read
it — a test suite, a build, a stress script, a migration dry-run, a
reproduction. You run it, judge the result and write the verdict on the
ticket. The reviewers read your resolution first.

The PR is someone else's: **never commit, push, open a PR, or comment on
GitHub**, and never fix what you find — a failing check is the finding. All
work happens in a worktree you make and delete. Nobody is watching this pane:
decide rather than ask.

## 1. Read the ticket and the project

```bash
jt show TICK-n | jq '{title, description, acceptanceCriteria, comments, projectId}'
jt project <PROJ-key> | jq '{repo, integrationBranch, prReview: .prReview.pr}'
jt set TICK-n assignee=claude status=in_progress
```

The description says what to run and what a pass looks like. The
`integrationBranch` (`jreview/pr-<n>`) is the PR head, fetched locally;
`prReview.pr.baseRefName` is its base (`origin/<base>`).

## 2. A throwaway worktree — the codebase's way

```bash
REPO="<project.repo>"
jt get "/api/repos/worktree?repo=$(jq -rn --arg r "$REPO" '$r|@uri')" | jq '{state, root: .guide.root, body: .guide.body}'
SHA="$(git -C "$REPO" rev-parse <integrationBranch>)"
```

- Guide `ready`/`stale` — make and set up the worktree as its body says
  (slim/test-only form when it has one), **detached at `$SHA`**, under its
  `root`.
- `missing` — `WT="$(mktemp -d)/TICK-n"; git -C "$REPO" worktree add --detach "$WT" "$SHA"`,
  then install deps the way the repo's CLAUDE.md/AGENTS.md says.

Everything below happens in `$WT`. A reproduction-style check also needs the
base: a second detached worktree at `origin/<base>`, or `git stash`-free
`git worktree add --detach "$WT-base" origin/<base>`.

## 3. Run the check

- Run exactly what the ticket says — the tightest command that covers it
  (the touched packages' tests, not the whole monorepo, unless asked).
- Read the output, don't just read the exit code: a suite that "passes"
  because it skipped the new tests, or failed on a missing env var, has
  proven nothing — say which.
- A failure: is it the PR's? Run the same command at the base. Fails at both →
  pre-existing, say so (verdict `concern` at most, unless the PR was meant to
  fix it).
- Flaky: run it again; report the rate (`3/5 runs`).
- Time-box it (30 minutes of honest effort). A check you couldn't stand up is
  `inconclusive` with the reason — a useful answer, not a failure.
- A throwaway test or script you wrote for the check is not committed: it
  goes, verbatim, into the resolution.

## 4. Record the verdict

The resolution's **first line** is the verdict — the Review setup tab and the
consensus session read it by that line:

````markdown
**Verdict:** fail — 2 of 41 tests in `packages/payments` fail at `a1b2c3d` (pass at base `origin/main`).

## What ran

`pnpm vitest run packages/payments` in a detached worktree at `a1b2c3d`; same at `origin/main` for the control.

## Result

```
<trimmed real output — the failing assertions or the error>
```

## What it means for the review

<one or two lines a reviewer can act on: which change caused it, where to look.>
````

Verdicts: `pass` (it ran and holds), `fail` (the PR breaks it — evidence
attached), `concern` (it holds, but something in the output deserves a
reviewer's eye: a new warning, a big slowdown, a pre-existing failure the PR
touches), `inconclusive` (couldn't run it — say exactly what stopped you).

```bash
jt set TICK-n status=done resolution=@resolution.md assignee=claude
```

Always `done`, whatever the verdict — the review plan moves on when every
check is done.

## 5. Tear the worktree down — always

```bash
git -C "$REPO" worktree remove --force "$WT" && git -C "$REPO" worktree prune
git -C "$REPO" worktree list    # yours is gone
```

With a guide, run its teardown first (containers, ports, databases). Then
reply with the verdict line and stop.
