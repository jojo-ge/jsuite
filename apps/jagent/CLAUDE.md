# jAgent

Dispatch jTicket tickets to claude agents — one git worktree + tmux session
per ticket — watch every agent's live diff, steer with nudges, and Accept to
turn a run into a PR reviewed in jDiff.

- **State**: `.data/jagent/jagent.json` (workspaces + runs), worktrees under
  `.data/jagent/worktrees/<ws>/`, per-run files under `.data/jagent/runs/`.
- **The board stays the source of truth.** jAgent claims tickets
  (assignee `jagent`, `in_progress`) before spawning, and only flips a ticket
  to `done` at Accept. Agents are told (preamble, `--append-system-prompt`) to
  write the resolution but never touch status — a run goes `needs_review` when
  its ticket's resolution changes, observed over jTicket's SSE stream.
- **tmux owns the agents**, not Nitro: runs survive restarts (reconciled
  against `tmux ls` on boot) and `tmux attach -t jagent-tick-7` is the escape
  hatch. tmux is a hard prerequisite; `gh` is required for Accept.
- **Diffs** come from `@jsuite/diff`'s `worktree` target: merge-base → working
  tree, untracked synthesised, never `git add -N`. No disk cache — the client
  polls with a content hash and shiki reruns only on real change.
- **Nothing rebases.** Worktrees are cut from base at dispatch; conflicts are
  a PR-time problem by design.
