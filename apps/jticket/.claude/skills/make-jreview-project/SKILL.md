---
name: make-jreview-project
description: Set up a jTicket PR review project for one GitHub pull request — the PR head fetched onto a local, never-pushed branch, then a Fable 5.2 assessor dispatched to decide how many reviewers it needs, what they focus on and which checks to run. Use when the user says "/make-jreview-project 123", "set up a review of PR 123", "review PR #123 with jreview", or wants several reviewers pointed at someone's pull request.
argument-hint: "[PR number] [--no-assess] [--no-start]"
---

# make-jreview-project — point jReview at a pull request

You turn a PR number into a **PR review project** in jTicket: a project
(mode `prreview`) whose only job is to review that PR — never to change it.
jTicket fetches the PR head into the local branch `jreview/pr-<n>` (forks
work too), and, unless told not to, dispatches one Fable 5.2 assessor
(`/jreview-assess`) that reads the PR and writes the project's **review
plan**: 2–4 reviewers on one shared brief, plus any checks worth running.
The plan then starts on its own when the assessment lands.

You don't review anything yourself, and you never comment on, approve or push
to the PR.

## 1. Pin down the repo and the PR

- **PR number** — the argument (`123`, `#123`, or a PR URL — take the number).
  None given: `gh pr list --limit 15` and ask which.
- **Repo** — the main checkout of the repo you are in (jTicket keys codebases
  by their main checkout, never a worktree):

```bash
REPO="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
gh pr view <n> --json number,title,author,headRefName,baseRefName,state,url
```

A PR URL from another repo than `$REPO`'s origin: ask for the local clone's
path instead of guessing. A closed or merged PR is fine to review — say so.

## 2. Make the project

```bash
jt projects >/dev/null || { echo "jTicket is down — ./jsuite status, then ./jsuite start"; exit 1; }
jt post /api/projects/pr-review "$(jq -n --arg repo "$REPO" --argjson pr <n> \
  '{repo: $repo, pr: $pr, assess: true, autoStart: true}')"
```

- `--no-assess` in the arguments → `assess: false` (the human presses Assess
  in the Review setup tab later).
- `--no-start` → `autoStart: false` (the assessment lands, the plan waits for
  Start).

The response is `{ project, created, assessing?: { agent }, assessError? }`.
An existing project for the same repo + PR comes back with `created: false`
and its PR refreshed — that's expected, not an error. `assessError` means the
project exists but the assessor didn't start (usually herdr isn't running, or
a run is already going) — say so and give the reason.

## 3. Report back

One short message:

- the project key and link: `https://jticket.local/projects/<KEY>?tab=review-setup`
- PR `#<n> <title>` by `@<author>`, `<head> → <base>`
- whether the assessor is running (herdr agent name) and whether the review
  starts by itself when it lands
- that findings arrive in the project's **Review** tab, where the human can
  post the ones they want to the PR as a comment review — and that nothing
  ever approves the PR for them

Then stop. The assessor, the checks and the reviewers run in herdr; jTicket
drives them.
